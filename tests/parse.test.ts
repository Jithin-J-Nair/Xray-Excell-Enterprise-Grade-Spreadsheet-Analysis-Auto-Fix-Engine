import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "@redoper1/xlsx-js-style";
import { MAX_MODEL_CELLS, parseFile } from "../src/lib/excel/parse";
import { workbookToXlsxBytes } from "../src/lib/excel/serialize";
import type { WorkbookModel } from "../src/lib/excel/types";

function xlsxBytes(workbook: XLSX.WorkBook): Uint8Array {
  const raw = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
}

describe("workbook parsing safety", () => {
  it("rejects a workbook that exceeds the model cell budget instead of returning partial data", async () => {
    const wb = XLSX.utils.book_new();
    const rows = Array.from({ length: MAX_MODEL_CELLS + 1 }, (_, i) => [i + 1]);
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "Large");
    const bytes = xlsxBytes(wb);
    await assert.rejects(() => parseFile("large", "large.xlsx", bytes), /MODEL_TRUNCATED/);
  });

  it("round-trips basic styles and dimensions through the parser model", async () => {
    const model: WorkbookModel = {
      fileId: "styled",
      fileName: "styled.xlsx",
      sheets: [{
        name: "Styled",
        visibility: "visible",
        rows: 1,
        cols: 1,
        cells: {
          A1: {
            a: "A1", r: 0, c: 0, t: "s", v: "Title",
            s: {
              font: { bold: true, color: { rgb: "FFFF0000" } },
              fill: { patternType: "solid", fgColor: { rgb: "FFFFFF00" } },
            },
          },
        },
        merges: [],
        columnWidths: [{ wch: 26 }],
        rowHeights: [{ hpt: 28 }],
      }],
      names: [],
    };
    const parsed = await parseFile("styled", "styled.xlsx", workbookToXlsxBytes(model));
    const style = parsed.sheets[0].cells.A1.s as { font?: { bold?: boolean } } | undefined;
    assert.equal(style?.font?.bold, true);
    assert.equal(parsed.sheets[0].columnWidths?.[0]?.wch, 26);
    assert.equal(parsed.sheets[0].rowHeights?.[0]?.hpt, 28);
  });

  it("marks XLSM inputs and refuses to export them as macro-less XLSX", async () => {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet([["data"]]), "Data");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const model = await parseFile("macro", "financial-model.xlsm", bytes);
    assert.equal(model.macroEnabled, true);
    assert.throws(() => workbookToXlsxBytes(model), /MACROS_UNSUPPORTED/);
  });

  it("preserves number-format codes when parsing an XLSX", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[12.5]]);
    ws.A1.z = "#,##0.00";
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const bytes = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as Uint8Array;
    const model = await parseFile("formatted", "formatted.xlsx", bytes);
    assert.equal(model.sheets[0].cells.A1.z, "#,##0.00");
  });
});
