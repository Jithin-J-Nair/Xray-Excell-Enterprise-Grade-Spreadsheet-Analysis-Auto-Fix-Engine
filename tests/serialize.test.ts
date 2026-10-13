import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "@redoper1/xlsx-js-style";
import ExcelJS from "exceljs";
import type { WorkbookModel } from "../src/lib/excel/types";
import { modelToNdjson, sheetToCsv, workbookToXlsxBytes } from "../src/lib/excel/serialize";

function model(): WorkbookModel {
  return {
    fileId: "f",
    fileName: "t.xlsx",
    sheets: [
      {
        name: "Vol",
        visibility: "visible",
        rows: 4,
        cols: 2,
        cells: {
          A1: {
            a: "A1", r: 0, c: 0, t: "s", v: "hdr",
            s: {
              font: { bold: true, color: { rgb: "FFFF0000" } },
              fill: { patternType: "solid", fgColor: { rgb: "FFFFFF00" } },
              alignment: { horizontal: "center" },
              border: { bottom: { style: "thin", color: { rgb: "FF000000" } } },
            },
          },
          A2: { a: "A2", r: 1, c: 0, t: "n", v: 4, f: "RANDBETWEEN(1,6)" }, // cached formula
          A3: { a: "A3", r: 2, c: 0, t: "s", v: null, f: "TODAY()" }, // UNCACHED formula
          A4: { a: "A4", r: 3, c: 0, t: "n", v: 10, f: "A2*2.5" }, // cached formula
        },
        merges: [],
        columnWidths: [{ wch: 22 }, { wch: 14 }],
        rowHeights: [{ hpt: 24 }],
      },
    ],
    names: [{ name: "P", ref: "Vol!$A$1", sheet: null, broken: false }],
  };
}

describe("xlsx export round-trip", () => {
  it("preserves formulas WITH and WITHOUT cached values", () => {
    const bytes = workbookToXlsxBytes(model());
    assert.ok(bytes.length > 500);
    const wb = XLSX.read(Buffer.from(bytes), { type: "buffer", cellFormula: true });
    const ws = wb.Sheets["Vol"];
    assert.equal(ws["A2"].f, "RANDBETWEEN(1,6)");
    assert.equal(ws["A2"].v, 4);
    assert.equal(ws["A3"].f, "TODAY()", "uncached formula must survive export");
    assert.equal(ws["A4"].f, "A2*2.5");
  });

  it("preserves merges and defined names", () => {
    const m = model();
    m.sheets[0].merges.push({ r1: 0, c1: 0, r2: 0, c2: 1 });
    const wb = XLSX.read(Buffer.from(workbookToXlsxBytes(m)), { type: "buffer" });
    assert.equal((wb.Sheets["Vol"]["!merges"] ?? []).length, 1);
    assert.ok((wb.Workbook?.Names ?? []).some((n) => n.Name === "P"));
  });

  it("round-trips basic cell styles, column widths, and row heights", async () => {
    const original = model();
    const bytes = workbookToXlsxBytes(original);
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(Buffer.from(bytes) as never);
    const ws = wb.getWorksheet("Vol");
    assert.ok(ws);
    assert.equal(ws.getCell("A1").font.bold, true);
    assert.equal(ws.getCell("A1").alignment?.horizontal, "center");
    assert.ok(ws.getColumn(1).width >= 22.8 && ws.getColumn(1).width < 23);
    assert.equal(ws.getRow(1).height, 24);
  });

  it("refuses to export a truncated workbook rather than silently dropping cells", () => {
    const partial = model();
    partial.truncated = true;
    assert.throws(() => workbookToXlsxBytes(partial), /MODEL_TRUNCATED/);
  });

  it("CSV export starts with UTF-8 BOM", () => {
    const csv = sheetToCsv(model().sheets[0]);
    assert.equal(csv.charCodeAt(0), 0xfeff);
    assert.ok(csv.includes("hdr"));
  });

  it("NDJSON export emits one line per row with sheet/row meta", () => {
    const nd = modelToNdjson(model(), "Vol");
    const lines = nd.trim().split("\n");
    assert.equal(lines.length, 4);
    const first = JSON.parse(lines[0]);
    assert.equal(first.__sheet, "Vol");
    assert.equal(first.__row, 1);
  });
});
