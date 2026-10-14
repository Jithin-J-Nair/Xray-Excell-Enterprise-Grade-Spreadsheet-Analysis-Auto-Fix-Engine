import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs, files, jobs, previews, uploads } from "@/db/schema";
import { and, desc, eq, ne, sql } from "drizzle-orm";
import { promises as fs } from "fs";
import { absOf } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
  if (!row) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
  const [fileRows, jobRows, auditRows] = await Promise.all([
    db.select().from(files).where(eq(files.uploadId, row.uploadId ?? "")),
    db.select().from(jobs).where(eq(jobs.analysisId, id)).orderBy(desc(jobs.createdAt)),
    db.select().from(auditLogs).where(eq(auditLogs.analysisId, id)).orderBy(desc(auditLogs.createdAt)).limit(80),
  ]);
  return NextResponse.json({
    id: row.id,
    name: row.name,
    mode: row.mode,
    status: row.status,
    progress: row.progress,
    statusText: row.statusText,
    error: row.error,
    createdAt: row.createdAt,
    completedAt: row.completedAt,
    options: row.options,
    result: row.result,
    sourceFiles: fileRows.map((f) => ({ id: f.id, name: f.name, size: f.size, mime: f.mime, sha256: f.sha256 })),
    jobs: jobRows.map((j) => ({
      id: j.id,
      kind: j.kind,
      status: j.status,
      progress: j.progress,
      formats: j.formats,
      outputs: j.outputs,
      summary: j.summary,
      error: j.error,
      reverted: j.reverted,
      undoFileId: j.undoFileId,
      patchFileId: j.patchFileId,
      createdAt: j.createdAt,
      completedAt: j.completedAt,
    })),
    audit: auditRows.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.createdAt })),
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const removed = await db.transaction(async (tx) => {
      const [row] = await tx.select().from(analyses).where(eq(analyses.id, id)).for("update").limit(1);
      if (!row) return null;

      // Lock the upload row while checking sharing, so a concurrent analysis
      // cannot start referencing the source files while this deletion removes them.
      if (row.uploadId) {
        await tx.select({ id: uploads.id }).from(uploads).where(eq(uploads.id, row.uploadId)).for("update").limit(1);
      }
      const [otherAnalysis] = row.uploadId
        ? await tx.select({ id: analyses.id }).from(analyses)
            .where(and(eq(analyses.uploadId, row.uploadId), ne(analyses.id, id))).limit(1)
        : [];
      const deleteSourceUpload = Boolean(row.uploadId && !otherAnalysis);
      const generatedFiles = await tx.select().from(files).where(eq(files.analysisId, id));
      const sourceFiles = deleteSourceUpload && row.uploadId
        ? await tx.select().from(files).where(eq(files.uploadId, row.uploadId))
        : [];
      const paths = [...new Set([...generatedFiles, ...sourceFiles].map((file) => file.path))];

      await tx.delete(previews).where(eq(previews.analysisId, id));
      await tx.delete(jobs).where(eq(jobs.analysisId, id));
      await tx.delete(files).where(eq(files.analysisId, id));
      if (deleteSourceUpload && row.uploadId) {
        await tx.delete(files).where(eq(files.uploadId, row.uploadId));
        await tx.delete(uploads).where(eq(uploads.id, row.uploadId));
      }

      // Preserve the previous audit trail, but detach it from the deleted row.
      await tx.update(auditLogs)
        .set({
          analysisId: null,
          detail: sql`${auditLogs.detail} || jsonb_build_object('deletedAnalysisId', ${id})`,
        })
        .where(eq(auditLogs.analysisId, id));
      await tx.delete(analyses).where(eq(analyses.id, id));
      await tx.insert(auditLogs).values({
        analysisId: null,
        action: "analysis.deleted",
        detail: { deletedAnalysisId: id, name: row.name, uploadId: row.uploadId },
      });
      return paths;
    });

    if (!removed) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });

    // Database records are already inaccessible; best-effort physical cleanup
    // removes source/output bytes as well. Missing files are harmless.
    await Promise.all(removed.map(async (storedPath) => {
      try {
        await fs.unlink(absOf(storedPath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("analysis-file-cleanup-failed", storedPath, error);
        }
      }
    }));
    return NextResponse.json({ status: "deleted" });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ errorCode: "DELETE_FAILED", message, retryable: true }, { status: 500 });
  }
}
