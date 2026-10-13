import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs, files, jobs } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { readBytes, saveBytes, sha256 } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Undo an apply job. Because originals are immutable and applies always write
 * to copies, reverting = re-materializing the pristine original bytes plus
 * marking the job as reverted (full audit trail).
 */
export async function POST(_req: NextRequest, ctx: { params: Promise<{ applyId: string }> }) {
  const { applyId } = await ctx.params;
  try {
    const [job] = await db.select().from(jobs).where(eq(jobs.id, applyId)).limit(1);
    if (!job || job.kind !== "apply") {
      return NextResponse.json({ errorCode: "NOT_FOUND", message: "Apply job not found", retryable: false }, { status: 404 });
    }
    if (job.status !== "completed") {
      return NextResponse.json({ errorCode: "NOT_COMPLETED", message: "Only completed applies can be reverted", retryable: false }, { status: 409 });
    }
    if (job.reverted) {
      return NextResponse.json({ errorCode: "ALREADY_REVERTED", message: "This apply has already been reverted", retryable: false }, { status: 409 });
    }
    const analysisId = job.analysisId!;
    const [analysis] = await db.select().from(analyses).where(eq(analyses.id, analysisId)).limit(1);
    if (!analysis) {
      return NextResponse.json({ errorCode: "ANALYSIS_NOT_FOUND", message: "Analysis not found", retryable: false }, { status: 404 });
    }
    if (analysis.mode === "local" || !analysis.uploadId) {
      await db
        .update(jobs)
        .set({ reverted: true, undoFileId: null, summary: { ...(job.summary as object), undo: "local-mode: original bytes remain on the client" } })
        .where(eq(jobs.id, job.id));
      await db.insert(auditLogs).values({ analysisId, action: "undo.performed", detail: { jobId: job.id, mode: "local" } });
      return NextResponse.json({ status: "reverted", mode: "local", message: "Local mode: original file never left the client; nothing to restore server-side." });
    }
    const [original] = await db
      .select()
      .from(files)
      .where(and(eq(files.uploadId, analysis.uploadId), eq(files.kind, "original")))
      .limit(1);
    if (!original) {
      return NextResponse.json({ errorCode: "ORIGINAL_MISSING", message: "Original file no longer available (retention window elapsed?)", retryable: false }, { status: 410 });
    }
    const bytes = await readBytes(original.path);
    const name = `reverted_${original.name}`;
    const saved = await saveBytes("exports", `undo-${job.id.slice(0, 8)}`, name, new Uint8Array(bytes));
    const [row] = await db
      .insert(files)
      .values({
        jobId: job.id,
        analysisId,
        kind: "reverted",
        name,
        size: bytes.length,
        mime: original.mime,
        path: saved.relPath,
        sha256: sha256(bytes),
        meta: { undoOf: job.id, originalFileId: original.id },
      })
      .returning();
    await db.update(jobs).set({ reverted: true, undoFileId: row.id }).where(eq(jobs.id, job.id));
    await db.insert(auditLogs).values({
      analysisId,
      action: "undo.performed",
      detail: { jobId: job.id, restoredFrom: original.name, sha256: sha256(bytes) },
    });
    return NextResponse.json({ status: "reverted", fileId: row.id, name });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "UNDO_FAILED", message, retryable: true, details: message }, { status: 500 });
  }
}
