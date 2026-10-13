import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { MAX_MODEL_CELLS, parseFile } from "../src/lib/excel/parse";

describe("workbook parsing safety", () => {
  it("rejects a workbook that exceeds the model cell budget instead of returning partial data", () => {
    const wb = XLSX.utils.book_new();
    const rows = Array.from({ length: MAX_MODEL_CELLS + 1 }, (_, i) => [i + 1]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Large");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    assert.throws(
      () => parseFile("large", "large.xlsx", bytes),
      /MODEL_TRUNCATED/
    );
  });

  it("preserves number-format codes when parsing an XLSX", () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[12.5]]);
    ws.A1.z = "#,##0.00";
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const model = parseFile("formatted", "formatted.xlsx", bytes);
    assert.equal(model.sheets[0].cells.A1.z, "#,##0.00");
  });
});
