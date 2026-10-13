import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { CellModel, SheetModel, WorkbookModel } from "../src/lib/excel/types";
import { applyTransforms } from "../src/lib/excel/transform";

const NBSP = String.fromCharCode(0xa0);

function c(addr: string, r: number, col: number, t: CellModel["t"], v: CellModel["v"], f?: string): CellModel {
  const cell: CellModel = { a: addr, r, c: col, t, v };
  if (f) cell.f = f;
  return cell;
}

function sheet(name: string, cells: CellModel[], merges: SheetModel["merges"] = []): SheetModel {
  const map: Record<string, CellModel> = {};
  let rows = 1;
  let cols = 1;
  for (const cell of cells) {
    map[cell.a] = cell;
    rows = Math.max(rows, cell.r + 1);
    cols = Math.max(cols, cell.c + 1);
  }
  return { name, visibility: "visible", rows, cols, cells: map, merges };
}

function workbook(sheets: SheetModel[], names: WorkbookModel["names"] = []): WorkbookModel {
  return { fileId: "f1", fileName: "test.xlsx", sheets, names };
}

describe("deterministic transformation rules", () => {
  it("T002 normalizes a deviating column formula to the majority pattern", () => {
    const m = workbook([
      sheet("S", [
        c("D2", 1, 3, "n", 1, "C2*0.08"),
        c("D3", 2, 3, "n", 1, "C3*0.08"),
        c("D4", 3, 3, "n", 1, "C4*0.1"),
        c("D5", 4, 3, "n", 1, "C5*0.08"),
      ]),
    ]);
    const { models, diffs } = applyTransforms([m], ["T002"]);
    assert.equal(models[0].sheets[0].cells["D4"].f, "C4*0.08");
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].ruleId, "T002");
  });

  it("T005 unmerges and fills anchor values", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "s", "Title")], [{ r1: 0, c1: 0, r2: 0, c2: 2 }])]);
    const { models, diffs } = applyTransforms([m], ["T005"]);
    assert.equal(models[0].sheets[0].merges.length, 0);
    assert.equal(models[0].sheets[0].cells["B1"].v, "Title");
    assert.equal(models[0].sheets[0].cells["C1"].v, "Title");
    assert.equal(diffs.length, 2);
  });

  it("T005 records a structural diff even when every cell in the range is occupied", () => {
    const m = workbook([
      sheet("S", [c("A1", 0, 0, "s", "Region"), c("B1", 0, 1, "s", "Revenue")], [{ r1: 0, c1: 0, r2: 0, c2: 1 }]),
    ]);
    const { models, diffs } = applyTransforms([m], ["T005"]);
    assert.equal(models[0].sheets[0].merges.length, 0);
    assert.equal(diffs.length, 1);
    assert.equal(diffs[0].kind, "structure");
    assert.match(String(diffs[0].before), /merged/);
  });

  it("T007 trims whitespace, NBSP and ideographic space", () => {
    const sp = String.fromCharCode(0x3000);
    const m = workbook([sheet("S", [c("A1", 0, 0, "s", ` ${NBSP}hello${sp} `)])]);
    const { models, diffs } = applyTransforms([m], ["T007"]);
    assert.equal(models[0].sheets[0].cells["A1"].v, "hello");
    assert.equal(diffs.length, 1);
  });

  it("T009 converts full-width to half-width", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "s", "ＴＯＫＹＯ１２３")])]);
    const { models } = applyTransforms([m], ["T009"]);
    assert.equal(models[0].sheets[0].cells["A1"].v, "TOKYO123");
  });

  it("T010 coerces Japanese date text into a date cell", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "s", "2024年3月5日")])]);
    const { models } = applyTransforms([m], ["T010"]);
    const cell = models[0].sheets[0].cells["A1"];
    assert.equal(cell.t, "d");
    assert.equal(String(cell.v).slice(0, 10), "2024-03-05");
  });

  it("T013 converts comma-grouped numeric text", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "s", "1,234,567")])]);
    const { models } = applyTransforms([m], ["T013"]);
    assert.equal(models[0].sheets[0].cells["A1"].v, 1234567);
    assert.equal(models[0].sheets[0].cells["A1"].t, "n");
  });

  it("T011 wraps error-producing formulas in IFERROR", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "e", "#DIV/0!", "1/0")])]);
    const { models } = applyTransforms([m], ["T011"]);
    assert.equal(models[0].sheets[0].cells["A1"].f, 'IFERROR(1/0,"")');
  });

  it("T004 freezes volatile formulas to cached values", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "n", 4, "RANDBETWEEN(1,6)")])]);
    const { models } = applyTransforms([m], ["T004"]);
    const cell = models[0].sheets[0].cells["A1"];
    assert.equal(cell.f, undefined);
    assert.equal(cell.v, 4);
  });

  it("T003 snapshots external links and writes SourceData", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "n", 8, "[Book.xlsx]Sheet1!A1*2")])]);
    const { models, diffs } = applyTransforms([m], ["T003"]);
    assert.equal(models[0].sheets[0].cells["A1"].f, undefined);
    assert.ok(models[0].sheets.some((s) => s.name === "SourceData"));
    assert.ok(diffs.some((d) => d.sheet === "SourceData"));
  });

  it("T006 removes broken and duplicate named ranges", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "n", 1)])], [
      { name: "OK", ref: "S!$A$1", sheet: null, broken: false },
      { name: "BAD", ref: "#REF!", sheet: null, broken: true },
      { name: "OK", ref: "S!$A$1", sheet: null, broken: false },
    ]);
    const { models } = applyTransforms([m], ["T006"]);
    assert.equal(models[0].names.length, 1);
    assert.equal(models[0].names[0].name, "OK");
  });

  it("T008 removes exact duplicate rows and shifts up", () => {
    const rowA = [c("A1", 0, 0, "s", "x"), c("B1", 0, 1, "n", 1)];
    const rowB = [c("A2", 1, 0, "s", "y"), c("B2", 1, 1, "n", 2)];
    const rowA2 = [c("A3", 2, 0, "s", "x"), c("B3", 2, 1, "n", 1)];
    const m = workbook([sheet("S", [...rowA, ...rowB, ...rowA2])]);
    const { models, diffs } = applyTransforms([m], ["T008"]);
    assert.equal(diffs.length, 1);
    assert.equal(models[0].sheets[0].cells["A3"], undefined);
    assert.equal(models[0].sheets[0].cells["A2"].v, "y");
  });

  it("T001 extracts repeated constants into a Parameters sheet with names", () => {
    const cells: CellModel[] = [
      c("A1", 0, 0, "n", 0, "B1*500"),
      c("A2", 1, 0, "n", 0, "B2*500"),
      c("A3", 2, 0, "n", 0, "B3*500"),
    ];
    const m = workbook([sheet("S", cells)]);
    const { models, diffs } = applyTransforms([m], ["T001"], { minOccurrences: 3 });
    assert.ok(models[0].sheets.some((s) => s.name === "Parameters"));
    assert.ok(models[0].names.some((n) => n.name === "PARAM_1"));
    assert.equal(models[0].sheets[0].cells["A1"].f, "B1*PARAM_1");
    assert.ok(diffs.some((d) => d.ruleId === "T001"));
  });

  it("input model is never mutated (deterministic preview)", () => {
    const m = workbook([sheet("S", [c("A1", 0, 0, "s", "  x ")])]);
    const before = JSON.stringify(m);
    applyTransforms([m], ["T007"]);
    assert.equal(JSON.stringify(m), before);
    // same inputs → identical outputs
    const a = applyTransforms([m], ["T007"]);
    const b = applyTransforms([m], ["T007"]);
    assert.deepEqual(a.diffs, b.diffs);
  });
});
