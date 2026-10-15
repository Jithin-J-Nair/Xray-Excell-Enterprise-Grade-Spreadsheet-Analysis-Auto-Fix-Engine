import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";
import type { WorkbookModel } from "../types";
import { parseFile } from "../parse";
import { verifyWorkbookExport } from "./verification";

export interface RecalculationOptions { executable?: string; timeoutMs?: number; verify?: boolean }
export interface RecalculationResult {
  bytes: Uint8Array; engine: "LibreOffice Calc"; formulasBefore: number; formulasAfter: number;
  verified: boolean; warnings: string[];
}
const formulaCount = (m: WorkbookModel) => m.sheets.reduce((n,s)=>n+Object.values(s.cells).filter(c=>!!c.f).length,0);
function run(command: string, args: string[], timeoutMs: number): Promise<{ code: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ["ignore", "pipe", "pipe"], windowsHide: true });
    let stdout = "", stderr = "", settled = false;
    const timer = setTimeout(() => { child.kill("SIGKILL"); if (!settled) { settled = true; reject(new Error("RECALCULATION_TIMEOUT")); } }, timeoutMs);
    child.stdout.setEncoding("utf8").on("data", (s: string) => { stdout += s; });
    child.stderr.setEncoding("utf8").on("data", (s: string) => { stderr += s; });
    child.once("error", error => { clearTimeout(timer); if (!settled) { settled = true; reject(new Error("RECALCULATION_ENGINE_UNAVAILABLE: " + error.message)); } });
    child.once("close", code => { clearTimeout(timer); if (!settled) { settled = true; resolve({ code, stdout, stderr }); } });
  });
}
/**
 * Recalculates a copy using LibreOffice Calc. This is not Microsoft Excel and does not
 * promise identical results for Excel-only functions, VBA, data models, pivots, or add-ins.
 * Requires an installed soffice executable. Source bytes are never modified.
 */
export async function recalculateWithLibreOffice(model: WorkbookModel, sourceBytes: Uint8Array, options: RecalculationOptions = {}): Promise<RecalculationResult> {
  if (model.truncated) throw new Error("MODEL_TRUNCATED: refusing to recalculate incomplete workbook.");
  if (model.macroEnabled || /\.xlsm$/i.test(model.fileName)) throw new Error("MACRO_WORKBOOK_BLOCKED: recalculation could discard VBA; use a macro-preserving Excel worker.");
  if (model.unsupportedFeatures?.length) throw new Error("UNSUPPORTED_WORKBOOK_FEATURES: recalculation blocked to avoid silently damaging " + model.unsupportedFeatures.join(", "));
  if (model.styleMetadataUnavailable) throw new Error("STYLE_METADATA_UNAVAILABLE: refusing recalculation when style fidelity is uncertain.");
  if (!/\.xlsx$/i.test(model.fileName)) throw new Error("RECALCULATION_FORMAT_UNSUPPORTED: only .xlsx workbooks are accepted.");
  const root = await mkdtemp(join(tmpdir(), "xray-recalc-"));
  const inputDir = join(root, "in"), outputDir = join(root, "out"), profileDir = join(root, "profile");
  const { mkdir } = await import("node:fs/promises");
  await Promise.all([mkdir(inputDir), mkdir(outputDir), mkdir(profileDir)]);
  const fileName = basename(model.fileName).replace(/[^\w.-]/g, "_");
  const inputPath = join(inputDir, fileName);
  try {
    await writeFile(inputPath, sourceBytes, { flag: "wx" });
    const profileUrl = pathToFileURL(profileDir).href;
    const result = await run(options.executable ?? process.env.LIBREOFFICE_PATH ?? "soffice",
      ["--headless", "-env:UserInstallation=" + profileUrl, "--convert-to", "xlsx", "--outdir", outputDir, inputPath],
      options.timeoutMs ?? 120_000);
    if (result.code !== 0) throw new Error("RECALCULATION_FAILED: " + (result.stderr || result.stdout || "LibreOffice exited unsuccessfully").slice(0, 2000));
    const outputPath = join(outputDir, fileName);
    let bytes: Uint8Array;
    try { bytes = new Uint8Array(await readFile(outputPath)); }
    catch { throw new Error("RECALCULATION_OUTPUT_MISSING: LibreOffice did not create a recalculated workbook."); }
    const reopened = await parseFile(model.fileId, fileName, bytes);
    const expected = new Set(model.sheets.flatMap(s=>Object.values(s.cells).filter(c=>!!c.f).map(c=>s.name+"!"+c.a)));
    const actual = new Set(reopened.sheets.flatMap(s=>Object.values(s.cells).filter(c=>!!c.f).map(c=>s.name+"!"+c.a)));
    const missing = [...expected].filter(a=>!actual.has(a));
    if (missing.length) throw new Error("RECALCULATION_FORMULAS_LOST: " + missing.slice(0, 20).join(", "));
    const warnings: string[] = ["Calculated by LibreOffice Calc; results may differ from Microsoft Excel for unsupported or proprietary functions."];
    let verified = false;
    if (options.verify ?? true) {
      const report = await verifyWorkbookExport(reopened, bytes);
      verified = report.ok;
      if (!report.ok) warnings.push("Round-trip verification reported " + report.issues.length + " issue(s).");
    }
    return { bytes, engine: "LibreOffice Calc", formulasBefore: formulaCount(model), formulasAfter: formulaCount(reopened), verified, warnings };
  } finally { await rm(root, { recursive: true, force: true }); }
}
