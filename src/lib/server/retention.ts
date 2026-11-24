import { and, eq, lt, notInArray, sql } from "drizzle-orm";
import { promises as fs } from "fs";
import { db } from "@/db";
import { analyses, files, uploads } from "@/db/schema";
import { deleteAnalysisRecords, unlinkStoredPaths } from "@/lib/server/analysis-cleanup";
import { absOf } from "@/lib/server/storage";

const DEFAULT_RETENTION_DAYS = 30;

/** Days before server-mode uploads/analyses are purged. Local mode stores no bytes. */
export function retentionDays(envValue = process.env.XRAY_RETENTION_DAYS): number {
  const n = Number(envValue ?? DEFAULT_RETENTION_DAYS);
  if (!Number.isFinite(n) || n < 1) return DEFAULT_RETENTION_DAYS;
  return Math.min(Math.floor(n), 3650);
}

export function retentionCutoff(now = new Date(), days = retentionDays()): Date {
  return new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
}

/**
 * Purge server analyses older than the retention window, then orphan uploads
 * that no longer have analyses. Matches the advertised 30-day policy.
 */
export async function purgeExpiredServerData(now = new Date()): Promise<{
  analysesPurged: number;
  orphanUploadsPurged: number;
}> {
  const cutoff = retentionCutoff(now);
  const expired = await db
    .select({ id: analyses.id })
    .from(analyses)
    .where(and(eq(analyses.mode, "server"), lt(analyses.createdAt, cutoff)))
    .limit(100);

  let analysesPurged = 0;
  for (const row of expired) {
    const paths = await deleteAnalysisRecords(row.id);
    if (paths) {
      await unlinkStoredPaths(paths);
      analysesPurged += 1;
    }
  }

  const referenced = await db
    .selectDistinct({ uploadId: analyses.uploadId })
    .from(analyses)
    .where(sql`${analyses.uploadId} is not null`);
  const referencedIds = referenced.map((r) => r.uploadId!).filter(Boolean);

  const orphanQuery = db
    .select({ id: uploads.id })
    .from(uploads)
    .where(lt(uploads.createdAt, cutoff))
    .limit(50);
  const candidates = referencedIds.length
    ? await db
        .select({ id: uploads.id })
        .from(uploads)
        .where(and(lt(uploads.createdAt, cutoff), notInArray(uploads.id, referencedIds)))
        .limit(50)
    : await orphanQuery;

  let orphanUploadsPurged = 0;
  for (const upload of candidates) {
    const sourceFiles = await db.select().from(files).where(eq(files.uploadId, upload.id));
    await db.delete(files).where(eq(files.uploadId, upload.id));
    await db.delete(uploads).where(eq(uploads.id, upload.id));
    for (const file of sourceFiles) {
      try {
        await fs.unlink(absOf(file.path));
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
          console.error("retention-orphan-cleanup-failed", file.path, error);
        }
      }
    }
    orphanUploadsPurged += 1;
  }

  return { analysesPurged, orphanUploadsPurged };
}
