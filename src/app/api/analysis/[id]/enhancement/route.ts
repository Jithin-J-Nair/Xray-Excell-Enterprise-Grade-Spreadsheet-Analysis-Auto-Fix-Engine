import { NextRequest, NextResponse } from "next/server";
import { and, eq, ne } from "drizzle-orm";
import { basename, extname, join } from "node:path";
import { rm } from "node:fs/promises";
import { db } from "@/db";
import { analyses, auditLogs, files, jobs } from "@/db/schema";
import type { AnalysisResult, WorkbookModel } from "@/lib/excel/types";
import { allModels, analyzeAll } from "@/lib/excel/analyze";
import { workbookToXlsxBytes } from "@/lib/excel/serialize";
import { readBytes, saveBytes, sha256, absOf } from "@/lib/server/storage";
import { applyFormattingTheme, type FormattingOptions } from "@/lib/excel/enhancement/formatting";
import { inspectNumberFormats, repairNumberFormats, type FormatRepairOptions } from "@/lib/excel/enhancement/format-repair";
import { profileWorkbookQuality } from "@/lib/excel/enhancement/data-quality";
import { proposeFormulaRepairs, type FormulaRepairOptions } from "@/lib/excel/enhancement/formula-repair";
import { createRecoverySnapshot, sealRecoverySnapshot, undoWorkbook, parseRecoverySnapshot, fingerprintWorkbook, type RecoverySnapshot } from "@/lib/excel/enhancement/recovery";
import { verifyWorkbookExport } from "@/lib/excel/enhancement/verification";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Feature = "formatting" | "numberFormats" | "formulaRepairs";
type Action = "profile" | "preview" | "verify" | "apply" | "undo";
const FEATURES = new Set<Feature>(["formatting", "numberFormats", "formulaRepairs"]);
const MIME_XLSX = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const MAX_REPORT_ITEMS = 500;

function object(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}
function validateOptions(value: unknown): {
  formatting: FormattingOptions;
  numberFormats: FormatRepairOptions;
  formulaRepairs: FormulaRepairOptions;
} {
  if (value !== undefined && !object(value)) throw new Error("BAD_OPTIONS: options must be an object.");
  const input = (value ?? {}) as Record<string, unknown>;
  if (input.theme !== undefined && input.theme !== "report" && input.theme !== "financial") throw new Error("BAD_OPTIONS: theme must be report or financial.");
  if (input.currencyCode !== undefined && !["USD", "EUR", "GBP", "JPY", "CAD", "AUD"].includes(String(input.currencyCode))) throw new Error("BAD_OPTIONS: unsupported currencyCode.");
  for (const key of ["minColumnWidth", "maxColumnWidth", "minConfidence", "numberFormatMinConfidence", "formulaMinConfidence"] as const) {
    if (input[key] !== undefined && (typeof input[key] !== "number" || !Number.isFinite(input[key]))) throw new Error("BAD_OPTIONS: " + key + " must be a finite number.");
  }
  for (const key of ["headerRow", "neighborRadius", "minSupportingFormulas"] as const) {
    if (input[key] !== undefined && (!Number.isInteger(input[key]) || Number(input[key]) < 0)) throw new Error("BAD_OPTIONS: " + key + " must be a non-negative integer.");
  }
  if (input.neighborRadius !== undefined && (Number(input.neighborRadius) < 1 || Number(input.neighborRadius) > 20)) throw new Error("BAD_OPTIONS: neighborRadius must be between 1 and 20.");
  if (input.minSupportingFormulas !== undefined && (Number(input.minSupportingFormulas) < 2 || Number(input.minSupportingFormulas) > 20)) throw new Error("BAD_OPTIONS: minSupportingFormulas must be between 2 and 20.");
  for (const key of ["preserveExistingStyles", "preserveExistingColumnWidths", "bandedRows", "overwriteExisting"] as const) {
    if (input[key] !== undefined && typeof input[key] !== "boolean") throw new Error("BAD_OPTIONS: " + key + " must be boolean.");
  }
  for (const key of ["minConfidence", "numberFormatMinConfidence", "formulaMinConfidence"] as const) {
    if (input[key] !== undefined && (Number(input[key]) < 0 || Number(input[key]) > 1)) throw new Error("BAD_OPTIONS: " + key + " must be between 0 and 1.");
  }
  if (input.minColumnWidth !== undefined && Number(input.minColumnWidth) < 1) throw new Error("BAD_OPTIONS: minColumnWidth must be at least 1.");
  if (input.maxColumnWidth !== undefined && Number(input.maxColumnWidth) < Number(input.minColumnWidth ?? 10)) throw new Error("BAD_OPTIONS: maxColumnWidth must be greater than or equal to minColumnWidth.");
  return {
    formatting: {
      theme: input.theme as FormattingOptions["theme"],
      headerRow: input.headerRow as number | undefined,
      preserveExistingStyles: input.preserveExistingStyles as boolean | undefined,
      preserveExistingColumnWidths: input.preserveExistingColumnWidths as boolean | undefined,
      bandedRows: input.bandedRows as boolean | undefined,
      minColumnWidth: input.minColumnWidth as number | undefined,
      maxColumnWidth: input.maxColumnWidth as number | undefined,
    },
    numberFormats: {
      currencyCode: input.currencyCode as FormatRepairOptions["currencyCode"],
      minConfidence: (input.numberFormatMinConfidence ?? input.minConfidence) as number | undefined,
      overwriteExisting: input.overwriteExisting as boolean | undefined,
    },
    formulaRepairs: {
      minConfidence: input.formulaMinConfidence as number | undefined,
      neighborRadius: input.neighborRadius as number | undefined,
      minSupportingFormulas: input.minSupportingFormulas as number | undefined,
    },
  };
}
function selectFeatures(value: unknown): Feature[] {
  if (value === undefined) return ["formatting", "numberFormats"];
  if (!Array.isArray(value) || value.length === 0 || value.some(item => typeof item !== "string" || !FEATURES.has(item as Feature))) {
    throw new Error("BAD_FEATURES: choose one or more of formatting, numberFormats, formulaRepairs.");
  }
  return [...new Set(value as Feature[])];
}
function currentModels(result: AnalysisResult): WorkbookModel[] {
  return allModels(result);
}
function refreshAnalysisResult(previous: AnalysisResult, models: WorkbookModel[], resolveCrossFile: boolean): AnalysisResult {
  const metas = models.map(model => {
    const existing = previous.files.find(file => file.id === model.fileId || file.name === model.fileName);
    return { id: model.fileId, name: model.fileName, size: existing?.size ?? 0, encoding: model.encoding };
  });
  return analyzeAll(models, metas, { language: previous.language, resolveCrossFile, name: previous.name });
}
function profile(model: WorkbookModel, options: ReturnType<typeof validateOptions>) {
  const quality = profileWorkbookQuality(model);
  const formats = inspectNumberFormats(model, options.numberFormats);
  const formulas = proposeFormulaRepairs(model, options.formulaRepairs);
  return {
    fileName: model.fileName,
    quality: { columns: quality.columns, totalFindings: quality.findings.length, findings: quality.findings.slice(0, MAX_REPORT_ITEMS), truncated: quality.findings.length > MAX_REPORT_ITEMS },
    numberFormats: { totalFindings: formats.length, findings: formats.slice(0, MAX_REPORT_ITEMS), truncated: formats.length > MAX_REPORT_ITEMS },
    formulaRepairs: { totalProposals: formulas.proposals.length, proposals: formulas.proposals.slice(0, MAX_REPORT_ITEMS), truncated: formulas.proposals.length > MAX_REPORT_ITEMS },
  };
}
function applyFeatures(model: WorkbookModel, features: Feature[], options: ReturnType<typeof validateOptions>, applyFormula: boolean) {
  let current = model;
  const changes = { formatting: 0, numberFormats: 0, formulaRepairs: 0 };
  if (features.includes("formatting")) {
    const result = applyFormattingTheme(current, options.formatting);
    current = result.model;
    changes.formatting = result.changes.length;
  }
  if (features.includes("numberFormats")) {
    const result = repairNumberFormats(current, { ...options.numberFormats, apply: true });
    current = result.model;
    changes.numberFormats = result.findings.filter(item => item.applied).length;
  }
  if (features.includes("formulaRepairs")) {
    const result = proposeFormulaRepairs(current, { ...options.formulaRepairs, apply: applyFormula });
    current = result.model;
    changes.formulaRepairs = applyFormula ? result.proposals.filter(item => item.applied).length : result.proposals.filter(item => item.confidence >= (options.formulaRepairs.minConfidence ?? 0.95)).length;
  }
  return { model: current, changes };
}
function assertSerializable(models: WorkbookModel[]) {
  for (const model of models) {
    if (model.truncated) throw new Error("MODEL_TRUNCATED: refusing to enhance a partial workbook.");
    if (model.macroEnabled || /\.xlsm$/i.test(model.fileName)) throw new Error("MACRO_PRESERVATION_REQUIRED: this reduced-model enhancement path cannot safely rewrite macro-enabled workbooks.");
    if (model.styleMetadataUnavailable) throw new Error("STYLE_METADATA_UNAVAILABLE: refusing to rewrite workbook with uncertain style fidelity.");
    if (model.unsupportedFeatures?.length) throw new Error("UNSUPPORTED_WORKBOOK_FEATURES: refusing to rewrite " + model.fileName + " because preservation is not guaranteed: " + model.unsupportedFeatures.join(", "));
  }
}
function outputName(model: WorkbookModel, index: number, suffix: "enhanced" | "restored"): string {
  const stem = basename(model.fileName, extname(model.fileName)).replace(/[^\w.-]/g, "_").slice(0, 90) || "workbook";
  return (index + 1) + "_" + stem + "_" + suffix + ".xlsx";
}
async function cleanupJobFiles(jobId: string, undo = false) {
  const buckets = undo ? ["exports"] : ["exports", "patches"];
  for (const bucket of buckets) {
    try { await rm(absOf(join(bucket, undo ? jobId + "-undo" : jobId)), { recursive: true, force: true }); }
    catch (error) { console.error("enhancement-cleanup-failed", jobId, bucket, error); }
  }
}

/**
 * POST /api/analysis/:id/enhancement
 * Actions: profile, preview, verify, apply, undo. Mutating operations write separate
 * outputs, persist a recovery snapshot and audit records, and never overwrite source files.
 */
export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  let jobId: string | undefined;
  let undoMode = false;
  try {
    const raw: unknown = await req.json();
    if (!object(raw) || typeof raw.action !== "string" || !["profile", "preview", "verify", "apply", "undo"].includes(raw.action)) {
      return NextResponse.json({ errorCode: "BAD_REQUEST", message: "action must be profile, preview, verify, apply, or undo.", retryable: false }, { status: 400 });
    }
    const action = raw.action as Action;
    if (action === "undo") {
      if (typeof raw.jobId !== "string" || !raw.jobId) return NextResponse.json({ errorCode: "BAD_REQUEST", message: "jobId is required for undo.", retryable: false }, { status: 400 });
      undoMode = true;
      return await undoEnhancement(id, raw.jobId);
    }
    const options = validateOptions(raw.options);
    const [analysis] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
    if (!analysis) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found.", retryable: false }, { status: 404 });
    if (analysis.status !== "completed" || !analysis.result) return NextResponse.json({ errorCode: "NOT_READY", message: "Analysis must be completed before enhancement.", retryable: true }, { status: 409 });
    const result = analysis.result as unknown as AnalysisResult;
    const models = currentModels(result);
    if (!models.length) return NextResponse.json({ errorCode: "NO_WORKBOOKS", message: "No workbook models are available for this analysis.", retryable: false }, { status: 409 });

    if (action === "profile") {
      return NextResponse.json({ action, files: models.map(model => profile(model, options)) });
    }
    if (action === "verify") {
      return NextResponse.json({ action, files: await Promise.all(models.map(async model => ({ fileName: model.fileName, report: await verifyWorkbookExport(model) }))) });
    }
    const features = selectFeatures(raw.features);
    const initialFingerprints = new Map(models.map(model => [model.fileId, fingerprintWorkbook(model)]));
    const confirmFormulaRepairs = raw.confirmFormulaRepairs === true;
    if (action === "apply" && features.includes("formulaRepairs") && !confirmFormulaRepairs) {
      return NextResponse.json({ errorCode: "FORMULA_CONFIRMATION_REQUIRED", message: "Formula repair requires confirmFormulaRepairs: true after reviewing proposals. Structural similarity is not proof of business correctness.", retryable: false }, { status: 409 });
    }
    if (action === "preview") {
      const previews = models.map(model => {
        let blockedReason: string | null = null;
        try { assertSerializable([model]); } catch (error) { blockedReason = error instanceof Error ? error.message : String(error); }
        const changed = blockedReason
          ? { changes: { formatting: 0, numberFormats: 0, formulaRepairs: 0 } }
          : applyFeatures(model, features, options, false);
        return {
          fileName: model.fileName, changes: changed.changes, blockedReason,
          profile: features.includes("formulaRepairs") && !blockedReason ? profile(model, options).formulaRepairs : undefined,
        };
      });
      return NextResponse.json({ action, features, files: previews, note: "Preview only; no workbook, database result, or source file was changed." });
    }

    const preflight = models.map(model => {
      try { assertSerializable([model]); return null; }
      catch (error) { return error instanceof Error ? error.message : String(error); }
    });
    if (preflight.every(reason => reason !== null)) {
      throw new Error("UNSUPPORTED_WORKBOOK_FEATURES: no workbook in this batch can be safely rewritten. " + preflight.filter(Boolean).join(" | "));
    }
    const [created] = await db.transaction(async tx => {
      const [locked] = await tx.select().from(analyses).where(eq(analyses.id, id)).for("update").limit(1);
      if (!locked || locked.status !== "completed" || !locked.result) throw new Error("ANALYSIS_STATE_CHANGED: refresh the analysis and retry.");
      const lockedModels = currentModels(locked.result as unknown as AnalysisResult);
      if (lockedModels.length !== initialFingerprints.size || lockedModels.some(model => initialFingerprints.get(model.fileId) !== fingerprintWorkbook(model))) {
        throw new Error("ANALYSIS_STATE_CHANGED: workbook models changed while this request was being prepared; preview again before applying.");
      }
      const [active] = await tx.select({ id: jobs.id }).from(jobs).where(and(eq(jobs.analysisId, id), eq(jobs.kind, "enhancement"), eq(jobs.status, "running"))).limit(1);
      if (active) throw new Error("ENHANCEMENT_ALREADY_RUNNING");
      const [createdJob] = await tx.insert(jobs).values({
        analysisId: id, kind: "enhancement", status: "running", progress: 5, formats: ["xlsx"],
        summary: { action: "apply", features, requestedAt: new Date().toISOString() },
      }).returning();
      await tx.insert(auditLogs).values({ analysisId: id, action: "enhancement.started", detail: { jobId: createdJob.id, features } });
      return [createdJob];
    });
    jobId = created.id;

    const snapshots = models.map((model, index) => preflight[index] ? null : createRecoverySnapshot(model));
    const transformed: Array<{ model: WorkbookModel; changes: { formatting: number; numberFormats: number; formulaRepairs: number }; blockedReason: string | null }> = models.map((model, index) => {
      const blockedReason = preflight[index];
      if (blockedReason) return { model, changes: { formatting: 0, numberFormats: 0, formulaRepairs: 0 }, blockedReason };
      return { ...applyFeatures(model, features, options, confirmFormulaRepairs), blockedReason: null };
    });
    const reports = await Promise.all(transformed.filter(item => !item.blockedReason).map(async item => ({ model: item.model, changes: item.changes, report: await verifyWorkbookExport(item.model) })));
    const failed = reports.find(item => !item.report.ok);
    if (failed) throw new Error("ENHANCEMENT_VERIFICATION_FAILED: " + failed.model.fileName + ": " + failed.report.issues.slice(0, 8).map(issue => issue.code + " " + issue.message).join("; "));
    const sealedSnapshots = snapshots.flatMap((snapshot, index) => snapshot ? [sealRecoverySnapshot(snapshot, transformed[index].model)] : []);
    const snapshotJson = JSON.stringify({ schemaVersion: 1, snapshots: sealedSnapshots });
    const snapshotBytes = new TextEncoder().encode(snapshotJson);
    const savedSnapshot = await saveBytes("patches", jobId, "enhancement-recovery.json", snapshotBytes);
    const savedOutputs: Array<{ model: WorkbookModel; name: string; bytes: Uint8Array; path: string }> = [];
    const outputRecords: Array<{ fileId: string; name: string; size: number }> = [];
    for (let index = 0; index < transformed.length; index++) {
      if (transformed[index].blockedReason) continue;
      const model = transformed[index].model;
      const bytes = workbookToXlsxBytes(model);
      const name = outputName(model, index, "enhanced");
      const saved = await saveBytes("exports", jobId, name, bytes);
      savedOutputs.push({ model, name, bytes, path: saved.relPath });
    }
    const analysisOptions = (analysis.options ?? {}) as { resolveCrossFile?: boolean };
    const updatedResult = refreshAnalysisResult(result, transformed.map(item => item.model), analysisOptions.resolveCrossFile !== false);
    await db.transaction(async tx => {
      const [snapshotRow] = await tx.insert(files).values({
        jobId, analysisId: id, kind: "patch", name: "enhancement-recovery.json", size: snapshotBytes.byteLength,
        mime: "application/json; charset=utf-8", path: savedSnapshot.relPath, sha256: sha256(snapshotBytes),
        meta: { schemaVersion: 1, modelCount: sealedSnapshots.length, purpose: "enhancement-recovery" },
      }).returning();
      const outputs: Array<{ format: string; fileId: string; name: string; size: number }> = [];
      for (const output of savedOutputs) {
        const [file] = await tx.insert(files).values({
          jobId, analysisId: id, kind: "export", name: output.name, size: output.bytes.byteLength,
          mime: MIME_XLSX, path: output.path, sha256: sha256(output.bytes),
          meta: { format: "xlsx", enhancement: features, sourceFile: output.model.fileName },
        }).returning();
        outputs.push({ format: "xlsx", fileId: file.id, name: file.name, size: file.size });
        outputRecords.push({ fileId: file.id, name: file.name, size: file.size });
      }
      await tx.update(analyses).set({ result: updatedResult }).where(eq(analyses.id, id));
      await tx.update(jobs).set({
        status: "completed", progress: 100, completedAt: new Date(), heartbeatAt: null, patchFileId: snapshotRow.id,
        outputs, summary: {
          action: "apply", features, fileCount: savedOutputs.length,
          changes: transformed.map(item => ({ fileName: item.model.fileName, ...item.changes, blockedReason: item.blockedReason })),
          verification: reports.map(item => ({ fileName: item.model.fileName, ok: item.report.ok, issues: item.report.issues.length })),
          skippedFiles: transformed.filter(item => item.blockedReason).map(item => ({ fileName: item.model.fileName, reason: item.blockedReason })),
          recoverySnapshotFileId: snapshotRow.id,
        },
      }).where(eq(jobs.id, jobId!));
      await tx.insert(auditLogs).values({
        analysisId: id, action: "enhancement.completed",
        detail: { jobId, features, outputs: outputs.map(output => output.fileId), snapshotFileId: snapshotRow.id },
      });
    });
    return NextResponse.json({
      action: "apply", jobId, status: "completed", features,
      outputs: outputRecords.map(output => ({ ...output, downloadUrl: "/api/outputs/" + output.fileId + "/download" })),
      skippedFiles: transformed.filter(item => item.blockedReason).map(item => ({ fileName: item.model.fileName, reason: item.blockedReason })),
      message: "Enhanced copies were created and verified where supported; unsupported files were left unchanged and original uploads remain unchanged.",
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (jobId) {
      await cleanupJobFiles(jobId, undoMode);
      await db.update(jobs).set({ status: "failed", error: message.slice(0, 2000), completedAt: new Date(), heartbeatAt: null }).where(eq(jobs.id, jobId)).catch(() => undefined);
      await db.insert(auditLogs).values({ analysisId: id, action: "enhancement.failed", detail: { jobId, error: message.slice(0, 1000) } }).catch(() => undefined);
    }
    const status = /ALREADY_RUNNING|STATE_CHANGED|CONFLICT|IN_PROGRESS/.test(message) ? 409 : /ANALYSIS_NOT_FOUND/.test(message) ? 404 : /SNAPSHOT_MISSING/.test(message) ? 410 : /UNSUPPORTED_WORKBOOK|MACRO_PRESERVATION|STYLE_METADATA|MODEL_TRUNCATED|VERIFICATION_FAILED|RECOVERY_/.test(message) ? 422 : 500;
    return NextResponse.json({ errorCode: "ENHANCEMENT_FAILED", message, retryable: status === 500 }, { status });
  }
}

async function undoEnhancement(analysisId: string, jobId: string) {
  const [existing] = await db.select().from(jobs).where(and(eq(jobs.id, jobId), eq(jobs.analysisId, analysisId), eq(jobs.kind, "enhancement"))).limit(1);
  if (!existing) return NextResponse.json({ errorCode: "ENHANCEMENT_NOT_FOUND", message: "Enhancement job not found.", retryable: false }, { status: 404 });
  if (existing.reverted) return NextResponse.json({ errorCode: "ALREADY_REVERTED", message: "This enhancement has already been undone.", retryable: false }, { status: 409 });
  if (existing.status !== "completed") return NextResponse.json({ errorCode: "NOT_COMPLETED", message: "Only completed enhancement jobs can be undone.", retryable: false }, { status: 409 });
  if (!existing.patchFileId) return NextResponse.json({ errorCode: "RECOVERY_SNAPSHOT_MISSING", message: "No recovery snapshot was persisted for this enhancement.", retryable: false }, { status: 410 });

  // Atomically claim the undo so duplicate requests cannot create multiple restore outputs.
  const [job] = await db.transaction(async tx => {
    const [lockedAnalysis] = await tx.select({ id: analyses.id }).from(analyses).where(eq(analyses.id, analysisId)).for("update").limit(1);
    if (!lockedAnalysis) return [];
    const [otherActive] = await tx.select({ id: jobs.id }).from(jobs).where(and(
      eq(jobs.analysisId, analysisId), eq(jobs.kind, "enhancement"), eq(jobs.status, "running"), ne(jobs.id, jobId)
    )).limit(1);
    if (otherActive) return [];
    return tx.update(jobs).set({ status: "running", progress: 10, heartbeatAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.analysisId, analysisId), eq(jobs.kind, "enhancement"), eq(jobs.status, "completed"), eq(jobs.reverted, false)))
      .returning();
  });
  if (!job) {
    const [latest] = await db.select().from(jobs).where(eq(jobs.id, jobId)).limit(1);
    if (latest?.reverted) return NextResponse.json({ errorCode: "ALREADY_REVERTED", message: "This enhancement has already been undone.", retryable: false }, { status: 409 });
    return NextResponse.json({ errorCode: "UNDO_IN_PROGRESS", message: "Another enhancement operation is in progress.", retryable: true }, { status: 409 });
  }

  try {
    const [analysis] = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
    if (!analysis?.result) throw new Error("ANALYSIS_NOT_FOUND: analysis result is no longer available.");
    const [snapshotFile] = await db.select().from(files).where(eq(files.id, job.patchFileId!)).limit(1);
    if (!snapshotFile || snapshotFile.analysisId !== analysisId || snapshotFile.kind !== "patch") throw new Error("RECOVERY_SNAPSHOT_MISSING: recovery snapshot is unavailable.");
    const snapshotBytes = await readBytes(snapshotFile.path);
    if (snapshotFile.sha256 && sha256(snapshotBytes) !== snapshotFile.sha256) throw new Error("RECOVERY_SNAPSHOT_CORRUPT: stored snapshot checksum does not match its database record.");
    const raw = JSON.parse(new TextDecoder().decode(snapshotBytes)) as { schemaVersion?: number; snapshots?: unknown[] };
    if (raw.schemaVersion !== 1 || !Array.isArray(raw.snapshots)) throw new Error("RECOVERY_SNAPSHOT_INVALID");
    const snapshots = raw.snapshots.map(item => parseRecoverySnapshot(JSON.stringify(item)));
    const current = currentModels(analysis.result as unknown as AnalysisResult);
    const restored = snapshots.map((snapshot: RecoverySnapshot) => {
      const match = current.find(model => model.fileId === snapshot.workbookId);
      if (!match) throw new Error("RECOVERY_CONFLICT: current workbook is missing from analysis state.");
      return undoWorkbook(snapshot, match);
    });
    const restoredById = new Map(restored.map(model => [model.fileId, model]));
    const allRestored = current.map(model => restoredById.get(model.fileId) ?? model);
    for (const model of restored) {
      const report = await verifyWorkbookExport(model);
      if (!report.ok) throw new Error("RECOVERY_VERIFICATION_FAILED: " + model.fileName + ": " + report.issues.slice(0, 5).map(issue => issue.code).join(", "));
    }
    const savedOutputs: Array<{ model: WorkbookModel; name: string; bytes: Uint8Array; path: string }> = [];
    for (let index = 0; index < restored.length; index++) {
      const model = restored[index], bytes = workbookToXlsxBytes(model), name = outputName(model, index, "restored");
      const saved = await saveBytes("exports", jobId + "-undo", name, bytes);
      savedOutputs.push({ model, name, bytes, path: saved.relPath });
    }
    const previousResult = analysis.result as unknown as AnalysisResult;
    const analysisOptions = (analysis.options ?? {}) as { resolveCrossFile?: boolean };
    const updatedResult = refreshAnalysisResult(previousResult, allRestored, analysisOptions.resolveCrossFile !== false);
    const outputIds: string[] = [];
    await db.transaction(async tx => {
      for (const output of savedOutputs) {
        const [file] = await tx.insert(files).values({
          jobId, analysisId, kind: "reverted", name: output.name, size: output.bytes.byteLength,
          mime: MIME_XLSX, path: output.path, sha256: sha256(output.bytes), meta: { restoredByEnhancementJob: jobId, sourceFile: output.model.fileName },
        }).returning();
        outputIds.push(file.id);
      }
      await tx.update(analyses).set({ result: updatedResult }).where(eq(analyses.id, analysisId));
      await tx.update(jobs).set({
        status: "completed", progress: 100, heartbeatAt: null, reverted: true, undoFileId: outputIds[0] ?? null,
        summary: { ...(job.summary as Record<string, unknown>), undo: { outputIds } },
      }).where(eq(jobs.id, jobId));
      await tx.insert(auditLogs).values({ analysisId, action: "enhancement.undone", detail: { jobId, outputs: outputIds } });
    });
    return NextResponse.json({
      status: "reverted", jobId,
      outputs: savedOutputs.map((output, index) => ({ fileId: outputIds[index], name: output.name, size: output.bytes.byteLength, downloadUrl: "/api/outputs/" + outputIds[index] + "/download" })),
    });
  } catch (error) {
    await cleanupJobFiles(jobId, true);
    await db.update(jobs).set({ status: "completed", heartbeatAt: null }).where(and(eq(jobs.id, jobId), eq(jobs.status, "running"))).catch(() => undefined);
    throw error;
  }
}
