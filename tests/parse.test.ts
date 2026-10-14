import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "@redoper1/xlsx-js-style";
import ExcelJS from "exceljs";
import { MAX_MODEL_CELLS, MAX_MODEL_GRID_CELLS, parseFile } from "../src/lib/excel/parse";
import { workbookToXlsxBytes } from "../src/lib/excel/serialize";
import type { WorkbookModel } from "../src/lib/excel/types";
import { buildMonster } from "../src/lib/excel/samples";
import { assertSafeZipContainer } from "../src/lib/excel/parse";

function xlsxBytes(workbook: XLSX.WorkBook): Uint8Array {
  const raw = XLSX.write(workbook, { type: "array", bookType: "xlsx" });
  return raw instanceof Uint8Array ? raw : new Uint8Array(raw as ArrayBuffer);
}

describe("workbook parsing safety", () => {
  it("rejects ZIP expansion bombs before decompression", () => {
    const bytes = new Uint8Array(68);
    const view = new DataView(bytes.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint32(20, 1, true);
    view.setUint32(24, 200 * 1024 * 1024, true);
    view.setUint16(28, 0, true);
    const eocd = 46;
    view.setUint32(eocd, 0x06054b50, true);
    view.setUint16(eocd + 8, 1, true);
    view.setUint16(eocd + 10, 1, true);
    view.setUint32(eocd + 12, 46, true);
    view.setUint32(eocd + 16, 0, true);
    assert.throws(() => assertSafeZipContainer(bytes), /ZIP_BOMB_SUSPECTED/);
  });


  it("loads the complex demo workbook without losing style metadata or blank-sheet semantics", async () => {
    const model = await parseFile("monster", "monster.xlsx", buildMonster());
    assert.equal(model.styleMetadataUnavailable, undefined);
    const empty = model.sheets.find((sheet) => sheet.name === "Empty Sheet");
    assert.ok(empty, "empty sheet remains present");
    assert.ok(
      Object.values(empty.cells).every((cell) => cell.v === "" || cell.v === null),
      "blank placeholder must not introduce meaningful data"
    );
  });

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

  it("blocks legacy Excel reconstruction when styles cannot be preserved", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([["Styled"]]);
    ws.A1.s = { font: { bold: true } };
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const bytes = xlsxBytes(wb);
    // The parser is intentionally told this is a legacy workbook: its format
    // path cannot reliably carry style metadata into an XLSX reconstruction.
    const model = await parseFile("legacy", "legacy.xls", bytes);
    assert.equal(model.styleMetadataUnavailable, true);
    assert.throws(() => workbookToXlsxBytes(model), /STYLE_METADATA_UNAVAILABLE/);
  });

  it("blocks data validation rules that the serializer cannot preserve", async () => {
    const workbook = new ExcelJS.Workbook();
    const sheet = workbook.addWorksheet("Validated");
    sheet.getCell("A1").value = "Choose";
    sheet.getCell("A2").dataValidation = { type: "list", formulae: ['"Yes,No"'] };
    const bytes = await workbook.xlsx.writeBuffer();
    const model = await parseFile("validation", "validation.xlsx", new Uint8Array(bytes));
    assert.ok(model.unsupportedFeatures?.includes("data validation rules"));
  });

  it("detects conditional formatting and blocks lossy XLSX reconstruction", async () => {
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet("Data");
    worksheet.addRow([10]);
    worksheet.addConditionalFormatting({
      ref: "A1",
      rules: [{
        type: "cellIs",
        priority: 1,
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
    const bytes = xlsxBytes(wb);
    const model = await parseFile("macro", "financial-model.xlsm", bytes);
    assert.equal(model.macroEnabled, true);
    assert.throws(() => workbookToXlsxBytes(model), /MACROS_UNSUPPORTED/);
  });

  it("preserves number-format codes when parsing an XLSX", async () => {
    const wb = XLSX.utils.book_new();
    const ws = XLSX.utils.aoa_to_sheet([[12.5]]);
    ws.A1.z = "#,##0.00";
    XLSX.utils.book_append_sheet(wb, ws, "Data");
    const bytes = xlsxBytes(wb);
    const model = await parseFile("formatted", "formatted.xlsx", bytes);
    assert.equal(model.sheets[0].cells.A1.z, "#,##0.00");
  });
});
