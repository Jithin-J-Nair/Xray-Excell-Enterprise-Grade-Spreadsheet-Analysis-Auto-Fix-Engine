import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkbookModel } from "../types";
import { parseFile } from "../parse";

export interface ExcelComOptions { powershell?: string; timeoutMs?: number }
export interface ExcelComResult {
  bytes: Uint8Array; engine: "Microsoft Excel COM"; formulasBefore: number; formulasAfter: number;
  verified: true; preservedFeatures: string[];
}
const formulaAddresses = (model: WorkbookModel) => model.sheets.flatMap(s => Object.values(s.cells).filter(c => !!c.f).map(c => s.name + "!" + c.a)).sort();
function runPowerShell(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { windowsHide: true, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => { child.kill(); if (!settled) { settled = true; reject(new Error("EXCEL_RECALCULATION_TIMEOUT")); } }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (s: string) => { stdout += s; });
    child.stderr.setEncoding("utf8").on("data", (s: string) => { stderr += s; });
    child.once("error", error => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error("EXCEL_COM_UNAVAILABLE: " + error.message)); } });
    child.once("close", code => { clearTimeout(timer); if (!settled) { settled = true; resolve({ code, stdout, stderr }); } });
  });
}
/**
 * Uses installed desktop Microsoft Excel through COM on Windows. It opens a disposable copy,
 * disables workbook macros and link updates, forces a full dependency rebuild, saves to a separate
 * path in the original file format, then reparses the result and verifies sheet/formula structure.
 * Excel must be installed/licensed on the host. Signed packages are blocked because edits invalidate signatures.
 */
export async function recalculateWithMicrosoftExcel(model: WorkbookModel, sourceBytes: Uint8Array, options: ExcelComOptions = {}): Promise<ExcelComResult> {
  if (process.platform !== "win32") throw new Error("EXCEL_COM_WINDOWS_ONLY: Microsoft Excel COM recalculation requires Windows.");
  if (model.truncated) throw new Error("MODEL_TRUNCATED: refusing to recalculate incomplete workbook.");
  if (!/\.xlsx$|\.xlsm$/i.test(model.fileName)) throw new Error("EXCEL_COM_FORMAT_UNSUPPORTED: only .xlsx and .xlsm are supported.");
  if (sourceBytes.byteLength < 4) throw new Error("INVALID_WORKBOOK_BYTES");
  if ((model.unsupportedFeatures ?? []).some(feature => /digital signatures/i.test(feature))) {
    throw new Error("SIGNED_WORKBOOK_BLOCKED: recalculation can invalidate digital signatures.");
  }
  const root = await mkdtemp(join(tmpdir(), "xray-excel-com-"));
  const inputDir = join(root, "in"), outputDir = join(root, "out");
  const { mkdir } = await import("node:fs/promises");
  await Promise.all([mkdir(inputDir), mkdir(outputDir)]);
  const fileName = basename(model.fileName).replace(/[^\w.-]/g, "_");
  const inputPath = join(inputDir, fileName), outputPath = join(outputDir, fileName);
  const scriptPath = join(root, "recalculate.ps1");
  const format = /\.xlsm$/i.test(fileName) ? 52 : 51;
  const script = [
    "param([string]$InputPath, [string]$OutputPath, [int]$FileFormat)",
    "$ErrorActionPreference = 'Stop'",
    "$excel = $null; $book = $null",
    "try {",
    "  $excel = New-Object -ComObject Excel.Application",
    "  $excel.Visible = $false; $excel.DisplayAlerts = $false; $excel.AskToUpdateLinks = $false",
    "  $excel.AutomationSecurity = 3",
    "  $excel.Calculation = -4105",
    "  $book = $excel.Workbooks.Open($InputPath, 0, $false, [Type]::Missing, [Type]::Missing, [Type]::Missing, $true)",
    "  $excel.CalculateFullRebuild()",
    "  $book.SaveAs($OutputPath, $FileFormat)",
    "  $book.Close($true); $book = $null",
    "  Write-Output 'XRAY_EXCEL_RECALCULATION_OK'",
    "} catch { Write-Error $_; exit 31 } finally {",
    "  if ($book -ne $null) { try { $book.Close($false) } catch {} }",
    "  if ($excel -ne $null) { try { $excel.Quit() } catch {} }",
    "  if ($book -ne $null) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($book) }",
    "  if ($excel -ne $null) { [void][Runtime.InteropServices.Marshal]::FinalReleaseComObject($excel) }",
    "  [GC]::Collect(); [GC]::WaitForPendingFinalizers()",
    "}"
  ].join("\r\n");
  try {
    await writeFile(inputPath, sourceBytes, { flag: "wx" });
    await writeFile(scriptPath, script, { flag: "wx" });
    const result = await runPowerShell(options.powershell ?? process.env.POWERSHELL_PATH ?? "powershell.exe",
      ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass", "-File", scriptPath, inputPath, outputPath, String(format)],
      options.timeoutMs ?? 180_000);
    if (result.code !== 0 || !result.stdout.includes("XRAY_EXCEL_RECALCULATION_OK")) {
      throw new Error("EXCEL_RECALCULATION_FAILED: " + (result.stderr || result.stdout || "Excel automation did not confirm success").slice(0, 3000));
    }
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readFile(outputPath)); }
    catch { throw new Error("EXCEL_RECALCULATION_OUTPUT_MISSING"); }
    const reopened = await parseFile(model.fileId, fileName, bytes);
    const before = formulaAddresses(model), after = formulaAddresses(reopened);
    const missing = before.filter(address => !after.includes(address));
    if (model.sheets.length !== reopened.sheets.length || missing.length || before.length !== after.length) {
      throw new Error("EXCEL_RECALCULATION_STRUCTURE_MISMATCH: sheet count or formula locations changed.");
    }
    const oldFeatures = new Set(model.unsupportedFeatures ?? []);
    const newFeatures = new Set(reopened.unsupportedFeatures ?? []);
    const lostFeatures = [...oldFeatures].filter(feature => !newFeatures.has(feature));
    if (lostFeatures.length) throw new Error("EXCEL_RECALCULATION_FEATURE_MISMATCH: feature markers disappeared after save: " + lostFeatures.join(", "));
    return { bytes, engine: "Microsoft Excel COM", formulasBefore: before.length, formulasAfter: after.length,
      verified: true, preservedFeatures: [...newFeatures] };
  } finally { await rm(root, { recursive: true, force: true }); }
}
