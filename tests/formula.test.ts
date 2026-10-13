import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { abstractFormula, instantiateTemplate, parseFormula, replaceNumberLiteral } from "../src/lib/excel/formula";

describe("formula tokenizer", () => {
  it("extracts plain refs, functions and numbers", () => {
    const p = parseFormula("SUM(B2:B30)*0.08+VLOOKUP(A2,'Lookup Tables'!$A$2:$B$9,2,FALSE)");
    assert.ok(p.functions.includes("SUM"));
    assert.ok(p.functions.includes("VLOOKUP"));
    assert.ok(p.numbers.includes("0.08"));
    const range = p.refs.find((r) => r.raw.includes("B2:B30"));
    assert.ok(range, "range ref found");
    assert.equal(range!.r1, 1);
    assert.equal(range!.r2, 29);
    const sheetRef = p.refs.find((r) => r.sheet === "Lookup Tables");
    assert.ok(sheetRef, "quoted sheet ref found");
    assert.equal(sheetRef!.absCol1, true);
  });

  it("extracts external workbook refs", () => {
    const p = parseFormula("[Budget2023.xlsx]Sheet1!A1*B8");
    const ext = p.refs.find((r) => r.book !== null);
    assert.ok(ext, "external ref found");
    assert.equal(ext!.book, "Budget2023.xlsx");
    assert.equal(ext!.sheet, "Sheet1");
  });

  it("does not treat function names as identifiers or refs", () => {
    const p = parseFormula("IF(A1>LOG10(B2),NA(),TRUE)");
    assert.deepEqual(p.identifiers, []);
    assert.ok(p.functions.includes("LOG10"));
    assert.ok(p.functions.includes("NA"));
  });

  it("abstracts and re-instantiates formulas (R1C1 relocation)", () => {
    const tpl = abstractFormula("C2*0.08+'Rates'!$A$1", 1, 3); // D2
    const moved = instantiateTemplate(tpl, 4, 3); // D5 (one row above same col)
    assert.equal(moved, "C5*0.08+Rates!$A$1");
  });

  it("round-trips ranges with mixed absolutes, preserving $ signs", () => {
    const tpl = abstractFormula("SUM($B2:B$9)", 0, 0);
    assert.ok(tpl.includes("⟦"), "template has markers");
    // host moves from A1 to A4 → relative row shifts by +3
    const moved = instantiateTemplate(tpl, 3, 0);
    assert.equal(moved, "SUM($B5:B$9)");
  });

  it("replaces numeric literals without touching strings or refs", () => {
    const out = replaceNumberLiteral('B2*500+IF(A1="500",10,500)+A500', "500", "PARAM_1");
    assert.equal(out, 'B2*PARAM_1+IF(A1="500",10,PARAM_1)+A500');
  });
});
