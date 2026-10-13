import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs, files, jobs, previews } from "@/db/schema";
import { desc, eq } from "drizzle-orm";

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
  const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
  if (!row) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
  await db.delete(previews).where(eq(previews.analysisId, id));
  await db.delete(jobs).where(eq(jobs.analysisId, id));
  await db.insert(auditLogs).values({ analysisId: id, action: "analysis.deleted", detail: {} });
  await db.delete(auditLogs).where(eq(auditLogs.analysisId, id));
  await db.delete(analyses).where(eq(analyses.id, id));
  return NextResponse.json({ status: "deleted" });
}
