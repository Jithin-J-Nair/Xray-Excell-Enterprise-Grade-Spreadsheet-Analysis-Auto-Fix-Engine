import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { WorkbookModel } from "../src/lib/excel/types";
import { inspectNumberFormats, repairNumberFormats } from "../src/lib/excel/enhancement/format-repair";
import { createRecoverySnapshot, sealRecoverySnapshot, undoWorkbook, serializeRecoverySnapshot, parseRecoverySnapshot } from "../src/lib/excel/enhancement/recovery";
import { processWorkbookBatch } from "../src/lib/excel/enhancement/batch";
import { verifyWorkbookExport, verifyRecalculatedWorkbook } from "../src/lib/excel/enhancement/verification";
import { proposeFormulaRepairs } from "../src/lib/excel/enhancement/formula-repair";
import { processWorkbookDirectory } from "../src/lib/excel/enhancement/batch-directory";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

function fixture(): WorkbookModel {
  return { fileId: "test-id", fileName: "fixture.xlsx", names: [], sheets: [{
    name: "Report", visibility: "visible", rows: 3, cols: 3, merges: [], cells: {
      A1: { a: "A1", r: 0, c: 0, t: "s", v: "Date" },
      B1: { a: "B1", r: 0, c: 1, t: "s", v: "Revenue" },
      C1: { a: "C1", r: 0, c: 2, t: "s", v: "Rate" },
      A2: { a: "A2", r: 1, c: 0, t: "d", v: "2025-01-15T00:00:00.000Z" },
      B2: { a: "B2", r: 1, c: 1, t: "n", v: 1250.5 },
      C2: { a: "C2", r: 1, c: 2, t: "n", v: 0.25 },
      A3: { a: "A3", r: 2, c: 0, t: "d", v: "2025-01-16T00:00:00.000Z" },
      B3: { a: "B3", r: 2, c: 1, t: "n", v: 200 },
      C3: { a: "C3", r: 2, c: 2, t: "n", v: 0.5 }
    }
  }] };
}

describe("semantic number-format repair", () => {
  it("inspects without mutating the workbook", () => {
    const model = fixture(), before = JSON.stringify(model);
    const findings = inspectNumberFormats(model, { currencyCode: "USD" });
    assert.ok(findings.some(f => f.cell === "A2" && f.kind === "date"));
    assert.equal(JSON.stringify(model), before);
    assert.ok(findings.every(f => !f.applied));
  });
  it("applies only high-confidence proposals and never changes values", () => {
    const model = fixture(), beforeValues = Object.fromEntries(Object.entries(model.sheets[0].cells).map(([a,c]) => [a,c.v]));
    const result = repairNumberFormats(model, { minConfidence: 0.8, currencyCode: "USD" });
    assert.equal(result.model.sheets[0].cells.A2.z, "yyyy-mm-dd");
    assert.equal(result.model.sheets[0].cells.B2.z, '"$"#,##0.00;[Red]("$"#,##0.00)');
    assert.deepEqual(Object.fromEntries(Object.entries(result.model.sheets[0].cells).map(([a,c]) => [a,c.v])), beforeValues);
    assert.ok(result.findings.some(f => f.applied));
  });
});

it("treats General as unformatted and applies explicit high-confidence formats", () => {
    const model = fixture();
    model.sheets[0].cells.B2.z = "General";
    const result = repairNumberFormats(model, { apply: true, currencyCode: "USD" });
    assert.equal(result.model.sheets[0].cells.B2.z, '"$"#,##0.00;[Red]("$"#,##0.00)');
    assert.ok(result.findings.some(f => f.cell === "B2" && f.applied));
  });
  
describe("guarded recovery snapshots", () => {
  it("restores all original cell data and formatting after a sealed change", () => {
    const original = fixture(), snapshot = createRecoverySnapshot(original, "2026-01-01T00:00:00.000Z");
    const changed = structuredClone(original);
    changed.sheets[0].cells.B2.s = { font: { bold: true }, fill: { patternType: "solid" } };
    changed.sheets[0].cells.B2.v = 999;
    const sealed = sealRecoverySnapshot(snapshot, changed);
    const restored = undoWorkbook(parseRecoverySnapshot(serializeRecoverySnapshot(sealed)), changed);
    assert.equal(JSON.stringify(restored), JSON.stringify(original));
  });
  it("refuses to overwrite unrelated changes made after the repair", () => {
    const original = fixture(), snapshot = sealRecoverySnapshot(createRecoverySnapshot(original), original);
    const changed = structuredClone(original); changed.sheets[0].cells.B2.v = 999;
    assert.throws(() => undoWorkbook(snapshot, changed), /RECOVERY_CONFLICT/);
  });
});

describe("bounded batch processing", () => {
  it("preserves result ordering and isolates per-file failures", async () => {
    const result = await processWorkbookBatch([
      { name: "a.xlsx", bytes: new Uint8Array([1]) },
      { name: "b.xlsx", bytes: new Uint8Array([2]) },
      { name: "c.xlsx", bytes: new Uint8Array([3]) }
    ], async file => {
      if (file.name === "b.xlsx") throw new Error("expected test failure");
      file.bytes[0] = 99;
      return file.bytes[0];
    }, { concurrency: 2 });
    assert.deepEqual(result.map(r => r.ok), [true, false, true]);
    assert.equal(result[0].ok && result[0].value, 99);
    assert.equal(result[1].ok ? "" : result[1].error, "expected test failure");
  });
  it("rejects duplicate names and unsafe paths before processing", async () => {
    await assert.rejects(() => processWorkbookBatch([{ name: "same.xlsx", bytes: new Uint8Array() }, { name: "SAME.xlsx", bytes: new Uint8Array() }], async () => true), /DUPLICATE_BATCH_FILENAME/);
    await assert.rejects(() => processWorkbookBatch([{ name: "../secret.xlsx", bytes: new Uint8Array() }], async () => true), /UNSAFE_BATCH_FILENAME/);
  });
});

describe("offline export verification", () => {
  it("exports and reopens a basic workbook without losing formulas", async () => {
    const model = fixture();
    model.sheets[0].cells.C3.f = "B2/500";
    const report = await verifyWorkbookExport(model);
    assert.equal(report.engine, "local-parser-roundtrip");
    assert.ok(report.bytes > 0);
    assert.equal(report.originalFormulaCount, 1);
    assert.equal(report.reopenedFormulaCount, 1);
    assert.equal(report.ok, true, JSON.stringify(report.issues));
  });
});

describe("recalculation structure verification", () => {
  it("allows formula cached values to recalculate but rejects literal-cell changes", () => {
    const before = fixture();
    before.sheets[0].cells.C3.f = "B2/500";
    const after = structuredClone(before);
    after.sheets[0].cells.C3.v = 2.501;
    assert.equal(verifyRecalculatedWorkbook(before, after).ok, true);
    after.sheets[0].cells.B2.v = 99;
    const report = verifyRecalculatedWorkbook(before, after);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some(issue => issue.code === "CELL_CONTENT_MISMATCH" && issue.cell === "B2"));
  });
  it("fails closed when a workbook has unsupported OOXML features", async () => {
    const model = fixture();
    model.unsupportedFeatures = ["charts"];
    const report = await verifyWorkbookExport(model);
    assert.equal(report.ok, false);
    assert.ok(report.issues.some(issue => issue.code === "EXPORT_BLOCKED"));
  });
});

describe("review-first formula repair", () => {
  it("proposes a structural outlier without changing formulas by default", () => {
    const model = fixture();
    const sheet = model.sheets[0];
    sheet.rows = 4;
    sheet.cells.B2.f = "C2*2";
    sheet.cells.B3 = { a: "B3", r: 2, c: 1, t: "n", v: 250, f: "C3*3" };
    sheet.cells.B4 = { a: "B4", r: 3, c: 1, t: "n", v: 600, f: "C4*2" };
    sheet.cells.C4 = { a: "C4", r: 3, c: 2, t: "n", v: 300 };
    sheet.cells.B1.v = "Calculated";
    sheet.cells.C2.v = 100; sheet.cells.C3.v = 200;
    const before = JSON.stringify(model);
    const result = proposeFormulaRepairs(model, { neighborRadius: 3 });
    assert.equal(JSON.stringify(model), before);
    assert.ok(result.proposals.some(p => p.cell === "B3" && p.proposed === "C3*2"));
    assert.ok(result.proposals.every(p => !p.applied));
  });
  it("only applies a high-confidence proposal when explicitly requested", () => {
    const model = fixture(), sheet = model.sheets[0];
    sheet.rows = 4;
    sheet.cells.B2.f = "C2*2";
    sheet.cells.B3 = { a: "B3", r: 2, c: 1, t: "n", v: 250, f: "C3*3" };
    sheet.cells.B4 = { a: "B4", r: 3, c: 1, t: "n", v: 600, f: "C4*2" };
    sheet.cells.C4 = { a: "C4", r: 3, c: 2, t: "n", v: 300 };
    sheet.cells.B1.v = "Calculated"; sheet.cells.C2.v = 100; sheet.cells.C3.v = 200;
    const result = proposeFormulaRepairs(model, { apply: true, minConfidence: 0.95 });
    assert.equal(result.model.sheets[0].cells.B3.f, "C3*2");
    assert.ok(result.proposals.some(p => p.cell === "B3" && p.applied));
  });
});

describe("safe directory batch processing", () => {
  it("recursively processes supported files in stable relative-path order", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-batch-test-"));
    try {
      await mkdir(join(root, "nested"));
      await writeFile(join(root, "a.xlsx"), new Uint8Array([1, 2]));
      await writeFile(join(root, "nested", "b.csv"), new Uint8Array([3]));
      await writeFile(join(root, "ignore.bin"), new Uint8Array([4]));
      const result = await processWorkbookDirectory(root, async file => file.name + ":" + file.bytes.length, { concurrency: 2 });
      assert.deepEqual(result.map(r => r.name), ["a.xlsx", "nested/b.csv"]);
      assert.ok(result.every(r => r.ok));
      assert.deepEqual([...await readFile(join(root, "a.xlsx"))], [1, 2], "source workbook remains unchanged");
    } finally { await rm(root, { recursive: true, force: true }); }
  });
  it("rejects oversized folder batches before reading files", async () => {
    const root = await mkdtemp(join(tmpdir(), "xray-batch-limit-"));
    try {
      await writeFile(join(root, "large.xlsx"), new Uint8Array(32));
      await assert.rejects(() => processWorkbookDirectory(root, async () => true, { maxBytesPerFile: 16 }), /BATCH_FILE_SIZE_LIMIT/);
    } finally { await rm(root, { recursive: true, force: true }); }
  });
});
