import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { buildCorpus, corpusSummary } from "../src/lib/excel/corpus";
import { parseFile } from "../src/lib/excel/parse";

describe("phase-3 generated corpus", () => {
  it("builds at least 30 unique workbook cases", () => {
    const cases = buildCorpus();
    const ids = new Set(cases.map((c) => c.id));
    assert.ok(cases.length >= 30, `expected ≥30 cases, got ${cases.length}`);
    assert.equal(ids.size, cases.length, "corpus ids must be unique");
    const summary = corpusSummary(cases);
    assert.ok((summary.byExpect["recalc-ok"] ?? 0) >= 5);
    assert.ok((summary.byExpect["export-ok"] ?? 0) >= 10);
  });

  it("every generated workbook parses without truncation", async () => {
    for (const c of buildCorpus()) {
      const model = await parseFile(c.id, c.fileName, c.bytes());
      assert.ok(!model.truncated, `${c.id} must not truncate`);
      assert.ok(model.sheets.length >= 1, `${c.id} needs a sheet`);
    }
  });
});
