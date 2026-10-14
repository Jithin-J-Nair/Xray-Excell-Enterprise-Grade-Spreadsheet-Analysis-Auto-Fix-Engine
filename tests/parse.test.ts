import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "@redoper1/xlsx-js-style";
import ExcelJS from "exceljs";
import { MAX_MODEL_CELLS, MAX_MODEL_GRID_CELLS, parseFile } from "../src/lib/excel/parse";
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

  it("rejects pathological sparse ranges before dense exports can explode", async () => {
    const wb = XLSX.utils.book_new();
    // Keep the fixture just above the 1M-cell grid cap. A full XFD1048576
    // range could make the test's XLSX writer itself iterate billions of cells.
    const ws: XLSX.WorkSheet = {
      A1: { t: "s", v: "start" },
      ZZ1500: { t: "n", v: 1 },
      "!ref": "A1:ZZ1500",
    };
    XLSX.utils.book_append_sheet(wb, ws, "Sparse");
    const bytes = xlsxBytes(wb);
    assert.equal(MAX_MODEL_GRID_CELLS, 1_000_000);
    await assert.rejects(() => parseFile("sparse", "sparse.xlsx", bytes), /MODEL_TRUNCATED/);
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

  it("detects conditional formatting and blocks lossy XLSX reconstruction", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.addRow([10]);
    worksheet.addConditionalFormatting({
      ref: "A1",
      rules: [{
        type: "cellIs",
        operator: "greaterThan",
        formulae: ["0"],
        style: { font: { bold: true } },
      }],
    });
    const raw = await workbook.xlsx.writeBuffer();
    const model = await parseFile("conditional", "conditional.xlsx", new Uint8Array(raw));
    assert.ok(model.unsupportedFeatures?.includes("conditional formatting"));
    assert.throws(() => workbookToXlsxBytes(model), /UNSUPPORTED_WORKBOOK_FEATURES/);
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
