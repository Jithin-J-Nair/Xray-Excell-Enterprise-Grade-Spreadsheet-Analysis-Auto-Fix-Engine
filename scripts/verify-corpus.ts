/**
 * Phase 3 corpus runner: parse → export verify → optional LibreOffice recalc.
 * Writes docs/RELEASE_BENCHMARK.md when --write-benchmark is passed.
 */
import { writeFileSync } from "node:fs";
import { performance } from "node:perf_hooks";
import ExcelJS from "exceljs";
import { buildCorpus, corpusSummary, type CorpusCase } from "../src/lib/excel/corpus";
import { parseFile } from "../src/lib/excel/parse";
import { verifyWorkbookExport } from "../src/lib/excel/enhancement/verification";
import { recalculateWithLibreOffice } from "../src/lib/excel/enhancement/recalculation";

type Outcome = "pass" | "fail" | "skip";

interface CaseResult {
  id: string;
  category: string;
  expect: string;
  outcome: Outcome;
  ms: number;
  reason?: string;
}

const writeBenchmark = process.argv.includes("--write-benchmark");
const skipRecalc = process.argv.includes("--skip-recalc");
const ciSubset = process.argv.includes("--ci-subset");

async function blockedHyperlinkCase(): Promise<CorpusCase> {
  const workbook = new ExcelJS.Workbook();
  const sheet = workbook.addWorksheet("Blocked");
  sheet.getCell("A1").value = { text: "link", hyperlink: "https://example.com" };
  const bytes = new Uint8Array(await workbook.xlsx.writeBuffer());
  return {
    id: "blocked-hyperlink",
    fileName: "blocked-hyperlink.xlsx",
    category: "blocked",
    expect: "export-blocked",
    bytes: () => bytes,
  };
}

async function runCase(c: CorpusCase): Promise<CaseResult> {
  const started = performance.now();
  try {
    const bytes = c.bytes();
    const model = await parseFile(c.id, c.fileName, bytes);
    if (model.truncated) {
      return { id: c.id, category: c.category, expect: c.expect, outcome: "fail", ms: performance.now() - started, reason: "MODEL_TRUNCATED" };
    }

    if (c.expect === "parse") {
      return { id: c.id, category: c.category, expect: c.expect, outcome: "pass", ms: performance.now() - started };
    }

    const report = await verifyWorkbookExport(model);
    if (c.expect === "export-blocked") {
      const blocked = !report.ok || Boolean(model.unsupportedFeatures?.length);
      return {
        id: c.id,
        category: c.category,
        expect: c.expect,
        outcome: blocked ? "pass" : "fail",
        ms: performance.now() - started,
        reason: blocked ? (model.unsupportedFeatures?.[0] ?? "export-not-ok") : "EXPECTED_BLOCK_MISSING",
      };
    }

    if (!report.ok) {
      return {
        id: c.id,
        category: c.category,
        expect: c.expect,
        outcome: "fail",
        ms: performance.now() - started,
        reason: report.issues.slice(0, 3).map((i) => i.code).join(",") || "EXPORT_VERIFY_FAILED",
      };
    }

    if (c.expect === "export-ok") {
      return { id: c.id, category: c.category, expect: c.expect, outcome: "pass", ms: performance.now() - started };
    }

    // recalc-ok
    if (skipRecalc) {
      return { id: c.id, category: c.category, expect: c.expect, outcome: "skip", ms: performance.now() - started, reason: "SKIP_RECALC" };
    }
    const result = await recalculateWithLibreOffice(model, bytes, {
      executable: process.env.LIBREOFFICE_PATH || "soffice",
      timeoutMs: 60_000,
      verify: true,
    });
    if (!result.verified) {
      return { id: c.id, category: c.category, expect: c.expect, outcome: "fail", ms: performance.now() - started, reason: "RECALC_UNVERIFIED" };
    }
    const reopened = await parseFile(c.id, c.fileName, result.bytes);
    const sheet = reopened.sheets[0];
    const cell = c.primaryCell ? sheet?.cells[c.primaryCell] : undefined;
    if (c.expectedValue != null && Number(cell?.v) !== c.expectedValue) {
      return {
        id: c.id,
        category: c.category,
        expect: c.expect,
        outcome: "fail",
        ms: performance.now() - started,
        reason: `VALUE_MISMATCH expected=${c.expectedValue} got=${String(cell?.v)}`,
      };
    }
    return { id: c.id, category: c.category, expect: c.expect, outcome: "pass", ms: performance.now() - started };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const code = message.split(":")[0] || "UNKNOWN";
    if (c.expect === "export-blocked" && /UNSUPPORTED|HYPERLINK|FEATURE/i.test(message)) {
      return { id: c.id, category: c.category, expect: c.expect, outcome: "pass", ms: performance.now() - started, reason: code };
    }
    return { id: c.id, category: c.category, expect: c.expect, outcome: "fail", ms: performance.now() - started, reason: code };
  }
}

function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return 0;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return sorted[idx];
}

async function main() {
  const generated = buildCorpus();
  const blocked = await blockedHyperlinkCase();
  let cases = [...generated, blocked];
  if (ciSubset) {
    // Keep CI fast: core formula smokes + one blocked + a few export-ok samples.
    const keep = new Set([
      "f-add",
      "f-mul",
      "f-sum",
      "f-two-operand",
      "clean-small",
      "jp-dates-shops",
      "struct-merged",
      "blocked-hyperlink",
    ]);
    cases = cases.filter((c) => keep.has(c.id));
  }

  const summary = corpusSummary(generated);
  const results: CaseResult[] = [];
  for (const c of cases) {
    results.push(await runCase(c));
  }

  const pass = results.filter((r) => r.outcome === "pass").length;
  const fail = results.filter((r) => r.outcome === "fail");
  const skip = results.filter((r) => r.outcome === "skip").length;
  const times = results.map((r) => r.ms).sort((a, b) => a - b);

  const report = {
    status: fail.length ? "FAIL" : "PASS",
    corpusGenerated: summary.total,
    ran: results.length,
    pass,
    fail: fail.length,
    skip,
    p50Ms: Math.round(percentile(times, 50)),
    p95Ms: Math.round(percentile(times, 95)),
    byExpect: summary.byExpect,
    byCategory: summary.byCategory,
    failures: fail.map((f) => ({ id: f.id, reason: f.reason })),
  };

  process.stdout.write(JSON.stringify(report, null, 2) + "\n");

  if (writeBenchmark) {
    const lines = [
      "# Release benchmark",
      "",
      `Generated: ${new Date().toISOString()}`,
      "",
      "## Corpus",
      "",
      `- Generated cases: **${summary.total}**`,
      `- Runner executed: **${results.length}** (${ciSubset ? "CI subset" : "full"})${skipRecalc ? " — recalc skipped" : ""}`,
      `- Pass / fail / skip: **${pass}** / **${fail.length}** / **${skip}**`,
      `- Per-case latency: p50 **${report.p50Ms} ms**, p95 **${report.p95Ms} ms**`,
      "",
      "### By expectation",
      "",
      ...Object.entries(summary.byExpect).map(([k, v]) => `- \`${k}\`: ${v}`),
      "",
      "### By category",
      "",
      ...Object.entries(summary.byCategory).map(([k, v]) => `- \`${k}\`: ${v}`),
      "",
      "## Engines",
      "",
      "- LibreOffice Calc (`soffice`) — formula recalculation smoke + corpus `recalc-ok` cases",
      "- Microsoft Excel COM — **manual Windows only** (`npm run verify:excel-com`); not claimed by Linux CI",
      "",
      "## Portfolio demo path",
      "",
      "1. Start the app (`npm run build && npm start`) with Basic Auth configured.",
      "2. Dashboard → generate **Monster** or **Japanese** sample.",
      "3. Open Analysis → Overview (Structural Health / Detected Risk) → Workbench preview → Apply.",
      "4. Enhancement Engine tab → profile / preview / verify (review-first formula repairs).",
      "5. Optional: recalculate with LibreOffice when installed; download verified exports.",
      "",
      "## Honest limits",
      "",
      "- Structural scores are not financial correctness.",
      "- LibreOffice results are not Microsoft Excel parity.",
      "- Unsupported OOXML features fail closed (see blocked-hyperlink corpus case).",
      "",
    ];
    writeFileSync("docs/RELEASE_BENCHMARK.md", lines.join("\n"));
  }

  if (fail.length) process.exitCode = 1;
}

main().catch((error) => {
  process.stderr.write(JSON.stringify({ status: "FAIL", error: error instanceof Error ? error.message : String(error) }) + "\n");
  process.exitCode = 1;
});
