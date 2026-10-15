import assert from "node:assert/strict";
import * as XLSX from "@redoper1/xlsx-js-style";
import { parseFile } from "../src/lib/excel/parse";
import { recalculateWithMicrosoftExcel } from "../src/lib/excel/enhancement/excel-com-recalculation";

async function main() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[2, 3, { t: "n", f: "A1+B1", v: 0 }]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Smoke");
  const sourceBytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const model = await parseFile("excel-com-smoke", "xray-excel-com-smoke.xlsx", sourceBytes);
  const result = await recalculateWithMicrosoftExcel(model, sourceBytes, {
    powershell: process.env.POWERSHELL_PATH || "powershell.exe",
    timeoutMs: 120_000,
  });
  const reopened = await parseFile("excel-com-smoke", "xray-excel-com-smoke.xlsx", result.bytes);
  const formula = reopened.sheets[0]?.cells.C1;
  assert.equal(formula?.f, "A1+B1", "formula text should survive recalculation");
  assert.equal(Number(formula?.v), 5, "Excel should update the cached formula result from 0 to 5");
  process.stdout.write(JSON.stringify({
    status: "PASS",
    engine: result.engine,
    formulasBefore: result.formulasBefore,
    formulasAfter: result.formulasAfter,
    cachedResult: formula?.v,
    verifiedStructure: result.verifiedStructure,
  }, null, 2) + "\n");
}

main().catch(error => {
  const code = error instanceof Error ? error.message.split(":")[0] : "UNKNOWN_FAILURE";
  process.stderr.write(JSON.stringify({ status: "FAIL", code }) + "\n");
  process.exitCode = 1;
});
