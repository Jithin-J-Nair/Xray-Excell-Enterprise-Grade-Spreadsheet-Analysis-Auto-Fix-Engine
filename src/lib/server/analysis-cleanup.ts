import { promises as fs } from "fs";
import { and, eq, ne, sql } from "drizzle-orm";
import { db } from "@/db";
import { analyses, auditLogs, files, jobs, previews, uploads } from "@/db/schema";
import { absOf } from "@/lib/server/storage";

/**
 * Delete one analysis and, when the upload is no longer shared, its source
 * files. Returns stored paths for best-effort filesystem cleanup.
 */
export async function deleteAnalysisRecords(analysisId: string): Promise<string[] | null> {
  return db.transaction(async (tx) => {
    const [row] = await tx.select().from(analyses).where(eq(analyses.id, analysisId)).for("update").limit(1);
    if (!row) return null;

    if (row.uploadId) {
      await tx.select({ id: uploads.id }).from(uploads).where(eq(uploads.id, row.uploadId)).for("update").limit(1);
    }
    const [otherAnalysis] = row.uploadId
      ? await tx
          .select({ id: analyses.id })
          .from(analyses)
          .where(and(eq(analyses.uploadId, row.uploadId), ne(analyses.id, analysisId)))
          .limit(1)
      : [];
    const deleteSourceUpload = Boolean(row.uploadId && !otherAnalysis);
    const generatedFiles = await tx.select().from(files).where(eq(files.analysisId, analysisId));
    const sourceFiles =
      deleteSourceUpload && row.uploadId
        ? await tx.select().from(files).where(eq(files.uploadId, row.uploadId))
        : [];
    const paths = [...new Set([...generatedFiles, ...sourceFiles].map((file) => file.path))];

    await tx.delete(previews).where(eq(previews.analysisId, analysisId));
    await tx.delete(jobs).where(eq(jobs.analysisId, analysisId));
    await tx.delete(files).where(eq(files.analysisId, analysisId));
    if (deleteSourceUpload && row.uploadId) {
      await tx.delete(files).where(eq(files.uploadId, row.uploadId));
      await tx.delete(uploads).where(eq(uploads.id, row.uploadId));
    }

    await tx
      .update(auditLogs)
      .set({
        analysisId: null,
        detail: sql`${auditLogs.detail} || jsonb_build_object('deletedAnalysisId', ${analysisId}::text)`,
      })
      .where(eq(auditLogs.analysisId, analysisId));
    await tx.delete(analyses).where(eq(analyses.id, analysisId));
    await tx.insert(auditLogs).values({
      analysisId: null,
      action: "analysis.deleted",
      detail: { deletedAnalysisId: analysisId, name: row.name, uploadId: row.uploadId },
    });
    return paths;
  });
}

/** Unlink stored paths after DB records are gone. Missing files are ignored. */
export async function unlinkStoredPaths(paths: string[]): Promise<void> {
  await Promise.all(
    paths.map(async (storedPath) => {
      try {
        await fs.unlink(absOf(storedPath));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("analysis-file-cleanup-failed", storedPath, error);
        }
      }
    })
  );
}
