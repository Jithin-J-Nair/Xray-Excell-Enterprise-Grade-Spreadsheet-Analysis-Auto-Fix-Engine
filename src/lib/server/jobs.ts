// ── Server job runners: analysis pipeline & apply/export pipeline ────────────
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { analyses, auditLogs, files, jobs, previews } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import type { AnalysisResult, WorkbookModel } from "@/lib/excel/types";
import { parseFile } from "@/lib/excel/parse";
import { allModels, analyzeAll, rescoreModel } from "@/lib/excel/analyze";
import { applyTransforms, toolById } from "@/lib/excel/transform";
import {
  buildMarkdownReport,
  modelToJson,
  modelToNdjson,
  sheetToCsv,
  workbookToXlsxBytes,
} from "@/lib/excel/serialize";
import { readBytes, saveBytes, sha256, stamp } from "./storage";

const enc = new TextEncoder();

export async function audit(analysisId: string | null, action: string, detail: Record<string, unknown> = {}): Promise<void> {
  try {
    await db.insert(auditLogs).values({ analysisId, action, detail });
  } catch (e) {
    console.error("audit-failed", e);
  }
}

type LogLine = { t: string; msg: string };
const now = () => new Date().toISOString();
const configuredHeartbeatMs = Number(process.env.XRAY_JOB_HEARTBEAT_MS ?? 15_000);
const HEARTBEAT_MS = Number.isFinite(configuredHeartbeatMs)
  ? Math.max(10_000, Math.min(60_000, configuredHeartbeatMs))
  : 15_000;

async function pushLog(analysisId: string, leaseToken: string, log: LogLine[], msg: string, progress: number, statusText: string) {
  log.push({ t: now(), msg });
  await db
    .update(analyses)
    .set({ log, progress, statusText, status: "processing", heartbeatAt: new Date() })
    .where(and(eq(analyses.id, analysisId), eq(analyses.leaseToken, leaseToken), eq(analyses.status, "processing")));
}

export async function runAnalysisJob(analysisId: string): Promise<void> {
  const log: LogLine[] = [];
  const leaseToken = randomUUID();
  // Atomic claim: the HTTP handler and durable worker may race, but only one
  // runner can transition a queued analysis into processing.
  const [row] = await db
    .update(analyses)
    .set({ status: "processing", statusText: "Starting", heartbeatAt: new Date(), leaseToken, attempts: sql`${analyses.attempts} + 1` })
    .where(and(eq(analyses.id, analysisId), eq(analyses.status, "queued")))
    .returning();
  if (!row) return;
  const heartbeat = setInterval(() => {
    void db.update(analyses)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(analyses.id, analysisId), eq(analyses.status, "processing"), eq(analyses.leaseToken, leaseToken)))
      .catch(() => console.error("analysis-heartbeat-failed"));
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  try {
    await pushLog(analysisId, leaseToken, log, "job: acquired — loading uploaded files", 4, "Loading files");
    const opts = (row.options ?? {}) as { resolveCrossFile?: boolean; language?: "en" | "jp"; name?: string };
    const fileRows = await db.select().from(files).where(eq(files.uploadId, row.uploadId!));
    if (!fileRows.length) throw new Error("NO_FILES: upload contains no files");
    const models: WorkbookModel[] = [];
    const metas: { id: string; name: string; size: number; encoding?: string }[] = [];
    let i = 0;
    for (const fr of fileRows) {
      i++;
      await pushLog(analysisId, leaseToken, log, `parse: ${fr.name} (${(fr.size / 1024).toFixed(1)} KB)`, 6 + i * 6, `Parsing ${fr.name}`);
      const bytes = await readBytes(fr.path);
      const model = await parseFile(fr.id, fr.name, new Uint8Array(bytes));
      models.push(model);
      metas.push({ id: fr.id, name: fr.name, size: fr.size, encoding: model.encoding });
    }
    await pushLog(analysisId, leaseToken, log, "extract: tokenizing formulas & building tables", 32, "Extracting formulas");
    await new Promise((r) => setImmediate(r));
    const result = analyzeAll(models, metas, {
      language: opts.language ?? "en",
      resolveCrossFile: opts.resolveCrossFile !== false,
      name: opts.name ?? row.name,
    });
    await pushLog(analysisId, leaseToken, log, `graph: ${result.graph.nodes.length} nodes / ${result.graph.edges.length} edges`, 58, "Building dependency graph");
    await new Promise((r) => setImmediate(r));
    await pushLog(analysisId, leaseToken, log, `scan: ${result.risks.length} findings (${result.metrics.risksBySeverity.critical} critical)`, 76, "Detecting risks");
    await pushLog(analysisId, leaseToken, log, `score: risk=${result.metrics.riskScore} health=${result.metrics.healthScore}`, 90, "Scoring workbook health");
    // strip the heavyweight raw model duplication (keep main + models for preview/apply)
    log.push({ t: now(), msg: "done: analysis complete" });
    const [published] = await db
      .update(analyses)
      .set({ status: "completed", progress: 100, statusText: "Completed", result, log, completedAt: new Date(), heartbeatAt: null, leaseToken: null })
      .where(and(eq(analyses.id, analysisId), eq(analyses.status, "processing"), eq(analyses.leaseToken, leaseToken)))
      .returning({ id: analyses.id });
    if (!published) throw new Error("JOB_LEASE_LOST: analysis result was not published because this worker no longer owns the lease.");
    await audit(analysisId, "analysis.completed", {
      files: metas.length,
      risks: result.risks.length,
      riskScore: result.metrics.riskScore,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("analysis-failed", { code: msg.split(":")[0].slice(0, 80) });
    await db
      .update(analyses)
      .set({ status: "failed", error: msg, completedAt: new Date(), statusText: "Failed", heartbeatAt: null })
      .where(and(eq(analyses.id, analysisId), eq(analyses.leaseToken, leaseToken), eq(analyses.status, "processing")));
    await audit(analysisId, "analysis.failed", { error: msg });
  } finally {
    clearInterval(heartbeat);
  }
}

// ── apply / export ───────────────────────────────────────────────────────────

const MIME: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  md: "text/markdown; charset=utf-8",
  patch: "application/json; charset=utf-8",
};


function safeJobErrorCode(message: string): string {
  return (message.split(":")[0] || "JOB_FAILED").replace(/[^A-Z0-9_]/gi, "").slice(0, 80) || "JOB_FAILED";
}

async function insertFileForLease(jobId: string, leaseToken: string, values: typeof files.$inferInsert) {
  return db.transaction(async tx => {
    const [owned] = await tx.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)
    )).for("update").limit(1);
    if (!owned) throw new Error("JOB_LEASE_LOST: this worker no longer owns the job lease.");
    const [row] = await tx.insert(files).values(values).returning();
    return row;
  });
}

export async function runApplyJob(jobId: string): Promise<void> {
  const leaseToken = randomUUID();
  // Claim queued jobs atomically so a request-triggered runner and the durable
  // worker cannot both generate the same exports. The token fences all later writes.
  const [job] = await db
    .update(jobs)
    .set({ status: "running", progress: 10, heartbeatAt: new Date(), leaseToken, attempts: sql`${jobs.attempts} + 1` })
    .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
    .returning();
  if (!job) return;
  const heartbeat = setInterval(() => {
    void db.update(jobs)
      .set({ heartbeatAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)))
      .catch(() => console.error("apply-heartbeat-failed"));
  }, HEARTBEAT_MS);
  heartbeat.unref?.();
  const analysisId = job.analysisId!;
  try {
    const [arow] = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
    if (!arow?.result) throw new Error("ANALYSIS_NOT_FOUND");
    const result = arow.result as unknown as AnalysisResult;
    const models = allModels(result);
    const formats = (job.formats ?? ["xlsx"]) as string[];
    const unsafeXlsxModel = models.find(
      (model) => model.macroEnabled || model.styleMetadataUnavailable || model.unsupportedFeatures?.length
    );
    if (formats.includes("xlsx") && unsafeXlsxModel) {
      if (unsafeXlsxModel.macroEnabled) {
        throw new Error(`MACROS_UNSUPPORTED: ${unsafeXlsxModel.fileName} is macro-enabled; XLSX export would discard VBA.`);
      }
      if (unsafeXlsxModel.styleMetadataUnavailable) {
        throw new Error(`STYLE_METADATA_UNAVAILABLE: ${unsafeXlsxModel.fileName} could not be read with reliable style metadata; XLSX export was blocked.`);
      }
      throw new Error(
        `UNSUPPORTED_WORKBOOK_FEATURES: ${unsafeXlsxModel.fileName} contains unsupported features: ${(unsafeXlsxModel.unsupportedFeatures ?? []).join(", ")}.`
      );
    }

    const [preview] = job.previewId
      ? await db.select().from(previews).where(eq(previews.id, job.previewId)).limit(1)
      : [null];
    const tools = (preview?.tools ?? []) as string[];
    const options = (preview?.options ?? {}) as { minOccurrences?: number };
    const language = (result.language ?? "en") as "en" | "jp";

    await db.update(jobs).set({ progress: 25 }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)));
    const before = models[0] ? rescoreModel(models[0], { language }) : 0;
    const { models: patched, diffs, summary } = applyTransforms(models, tools, options);
    const after = patched[0] ? rescoreModel(patched[0], { language }) : 0;
    summary.riskScoreBefore = before;
    summary.riskScoreAfter = after;
    summary.risksResolved = Math.max(0, before - after);

    await db.update(jobs).set({ progress: 45 }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)));
    const outputs: { format: string; fileId: string; name: string; size: number }[] = [];
    const main = patched[0];
    const baseName = (result.files[0]?.name ?? "workbook").replace(/\.[^.]+$/, "");
    const ts = stamp();

    // patch (reverse/undo) file — always produced, guarantees no silent data loss
    const patchDoc = JSON.stringify(
      {
        engine: "X-RAY://EXCEL v2",
        applyId: jobId,
        analysisId,
        appliedAt: now(),
        tools,
        options,
        diffs,
        reverse: diffs.map((d) => ({ ...d, before: d.after, after: d.before })),
        summary,
      },
      null,
      2
    );
    const patchName = `patch_${baseName}_${ts}.json`;
    const ps = await saveBytes("exports", jobId + "-" + leaseToken, patchName, enc.encode(patchDoc));
    const [patchRow] = await insertFileForLease(jobId, leaseToken, { jobId, analysisId, kind: "patch", name: patchName, size: enc.encode(patchDoc).byteLength, mime: MIME.patch, path: ps.relPath, sha256: sha256(enc.encode(patchDoc)) });
    await db.update(jobs).set({ patchFileId: patchRow.id, progress: 55 }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)));

    for (const model of patched) {
      const targetBase = (model.fileName || baseName).replace(/\.[^.]+$/, "");
      if (formats.includes("xlsx")) {
        const bytes = workbookToXlsxBytes(model);
        const name = `fixed_${targetBase}_${ts}.xlsx`;
        const saved = await saveBytes("exports", jobId + "-" + leaseToken, name, bytes);
        const [row2] = await insertFileForLease(jobId, leaseToken, { jobId, analysisId, kind: "export", name, size: bytes.length, mime: MIME.xlsx, path: saved.relPath, sha256: sha256(bytes), meta: { format: "xlsx" } });
        outputs.push({ format: "xlsx", fileId: row2.id, name, size: bytes.length });
      }
    }

    if (formats.includes("csv")) {
      const sheet = [...main.sheets].sort((a, b) => Object.keys(b.cells).length - Object.keys(a.cells).length)[0];
      const csv = sheetToCsv(sheet);
      const bytes = enc.encode(csv);
      const name = `${baseName}_${sheet.name}_${ts}.csv`.slice(0, 150);
      const saved = await saveBytes("exports", jobId + "-" + leaseToken, name, bytes);
      const [row2] = await insertFileForLease(jobId, leaseToken, { jobId, analysisId, kind: "export", name, size: bytes.length, mime: MIME.csv, path: saved.relPath, sha256: sha256(bytes), meta: { format: "csv", sheet: sheet.name, bom: true } });
      outputs.push({ format: "csv", fileId: row2.id, name, size: bytes.length });
    }
    if (formats.includes("json")) {
      const json = modelToJson(main, undefined, true);
      const bytes = enc.encode(json);
      const name = `${baseName}_${ts}.json`;
      const saved = await saveBytes("exports", jobId + "-" + leaseToken, name, bytes);
      const [row2] = await insertFileForLease(jobId, leaseToken, { jobId, analysisId, kind: "export", name, size: bytes.length, mime: MIME.json, path: saved.relPath, sha256: sha256(bytes), meta: { format: "json" } });
      outputs.push({ format: "json", fileId: row2.id, name, size: bytes.length });
    }
    if (formats.includes("ndjson")) {
      const nd = modelToNdjson(main);
      const bytes = enc.encode(nd);
      const name = `${baseName}_${ts}.ndjson`;
      const saved = await saveBytes("exports", jobId + "-" + leaseToken, name, bytes);
      const [row2] = await insertFileForLease(jobId, leaseToken, { jobId, analysisId, kind: "export", name, size: bytes.length, mime: MIME.ndjson, path: saved.relPath, sha256: sha256(bytes), meta: { format: "ndjson" } });
      outputs.push({ format: "ndjson", fileId: row2.id, name, size: bytes.length });
    }
    if (formats.includes("md")) {
      const audits = await db.select().from(auditLogs).where(eq(auditLogs.analysisId, analysisId));
      const md = buildMarkdownReport({
        analysis: result,
        toolsApplied: tools.map((t) => ({ id: t, name: toolById(t)?.name ?? t })),
        summary: summary as unknown as Record<string, unknown>,
        audits: audits.map((a) => ({ action: a.action, at: a.createdAt.toISOString(), detail: JSON.stringify(a.detail) })),
        language,
      });
      const bytes = enc.encode(md);
      const name = `report_${baseName}_${ts}.md`;
      const saved = await saveBytes("exports", jobId + "-" + leaseToken, name, bytes);
      const [row2] = await insertFileForLease(jobId, leaseToken, { jobId, analysisId, kind: "export", name, size: bytes.length, mime: MIME.md, path: saved.relPath, sha256: sha256(bytes), meta: { format: "md" } });
      outputs.push({ format: "md", fileId: row2.id, name, size: bytes.length });
    }

    await db
      .update(jobs)
      .set({ status: "completed", progress: 100, outputs, summary: summary as unknown as Record<string, unknown>, completedAt: new Date(), heartbeatAt: null, leaseToken: null })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)));
    await audit(analysisId, "apply.completed", {
      jobId,
      tools,
      cellsChanged: summary.cellsChanged,
      formulasChanged: summary.formulasChanged,
      rowsRemoved: summary.rowsRemoved,
      riskDelta: `${summary.riskScoreBefore}→${summary.riskScoreAfter}`,
      outputs: outputs.length,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    console.error("apply-failed", { jobId, code: msg.split(":")[0].slice(0, 80) });
    await db.update(jobs).set({ status: "failed", error: safeJobErrorCode(msg), completedAt: new Date(), heartbeatAt: null, leaseToken: null }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, leaseToken)));
    await audit(analysisId, "apply.failed", { jobId, error: msg });
  } finally {
    clearInterval(heartbeat);
  }
}
