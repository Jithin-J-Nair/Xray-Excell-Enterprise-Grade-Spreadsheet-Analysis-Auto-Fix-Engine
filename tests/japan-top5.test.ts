import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { CHECK_PACKS, summarizePack, summarizeAllPacks } from "../src/lib/excel/check-packs";
import { collectFormulaValueDiffs } from "../src/lib/excel/value-diff";
import type { AnalysisResult, WorkbookModel } from "../src/lib/excel/types";

function emptyModel(name: string, cells: Record<string, { v?: string | number | null; f?: string }>): WorkbookModel {
  return {
    fileId: "f1",
    fileName: name,
    sheets: [{ name: "Sheet1", visibility: "visible", cells: Object.fromEntries(
      Object.entries(cells).map(([addr, c]) => [addr, { t: typeof c.v === "number" ? "n" : "s", v: c.v ?? null, f: c.f }])
    ), merges: [], rows: 10, cols: 10 }],
    names: [],
    definedNames: [],
    externalLinks: [],
    styleMetadataUnavailable: false,
  } as unknown as WorkbookModel;
}

describe("role check packs", () => {
  it("exposes keiri / yosan / seikyu packs", () => {
    assert.deepEqual(CHECK_PACKS.map((p) => p.id), ["keiri", "yosan", "seikyu"]);
  });

  it("summarizes matching risk counts without inventing findings", () => {
    const result = {
      riskCounts: {
        DATE_AS_TEXT: 3,
        WHITESPACE: 2,
        HARDCODED_NUMBER: 5,
        DUPLICATE_ROWS: 1,
      },
      risks: [
        { id: "1", type: "DATE_AS_TEXT", severity: "warning", sheet: "A", cell: "B1", message: "", explanation: "" },
        { id: "2", type: "HARDCODED_NUMBER", severity: "info", sheet: "A", cell: "C1", message: "", explanation: "" },
      ],
    } as unknown as AnalysisResult;
    const keiri = summarizePack(result, "keiri")!;
    assert.equal(keiri.matchingRisks, 5); // 3+2
    assert.equal(keiri.byType.DATE_AS_TEXT, 3);
    const all = summarizeAllPacks(result);
    assert.equal(all.length, 3);
    assert.ok(all.find((p) => p.packId === "yosan")!.matchingRisks >= 5);
  });
});

describe("formula value diffs", () => {
  it("reports only formula cells whose cached value changed", () => {
    const before = emptyModel("a.xlsx", {
      A1: { f: "=B1+1", v: 10 },
      A2: { f: "=B2", v: 2 },
      A3: { v: 99 },
    });
    const after = emptyModel("a.xlsx", {
      A1: { f: "=B1+1", v: 11 },
      A2: { f: "=B2", v: 2 },
      A3: { v: 100 },
    });
    const rows = collectFormulaValueDiffs(before, after);
    assert.equal(rows.length, 1);
    assert.equal(rows[0].cell, "A1");
    assert.equal(rows[0].before, 10);
    assert.equal(rows[0].after, 11);
  });
});
