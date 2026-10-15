import assert from "node:assert/strict";
import * as XLSX from "@redoper1/xlsx-js-style";
import { parseFile } from "../src/lib/excel/parse";
import { recalculateWithLibreOffice } from "../src/lib/excel/enhancement/recalculation";

async function main() {
  const workbook = XLSX.utils.book_new();
  const sheet = XLSX.utils.aoa_to_sheet([[2, 3, { t: "n", f: "A1+B1", v: 0 }]]);
  XLSX.utils.book_append_sheet(workbook, sheet, "Smoke");
  const sourceBytes = new Uint8Array(XLSX.write(workbook, { type: "array", bookType: "xlsx" }));
  const model = await parseFile("libreoffice-smoke", "xray-recalc-smoke.xlsx", sourceBytes);
  const result = await recalculateWithLibreOffice(model, sourceBytes, {
    executable: process.env.LIBREOFFICE_PATH || "soffice",
    timeoutMs: 60_000,
    verify: true,
  });
  const reopened = await parseFile("libreoffice-smoke", "xray-recalc-smoke.xlsx", result.bytes);
  const formula = reopened.sheets[0]?.cells.C1;
  assert.equal(formula?.f, "A1+B1", "formula text should survive recalculation");
  assert.equal(Number(formula?.v), 5, "LibreOffice should update the cached formula result from 0 to 5");
  assert.equal(result.verified, true, "adapter export/reopen verification should pass");
  process.stdout.write(JSON.stringify({
    status: "PASS",
    engine: result.engine,
    formulasBefore: result.formulasBefore,
    formulasAfter: result.formulasAfter,
    cachedResult: formula?.v,
    verified: result.verified,
    warnings: result.warnings,
  }, null, 2) + "\n");
}

main().catch(error => {
  const code = error instanceof Error ? error.message.split(":")[0] : "UNKNOWN_FAILURE";
  process.stderr.write(JSON.stringify({ status: "FAIL", code }) + "\n");
  process.exitCode = 1;
});
