import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { jobs } from "@/db/schema";
import { eq } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [job] = await db.select().from(jobs).where(eq(jobs.id, id)).limit(1);
  if (!job) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Job not found" }, { status: 404 });
  return NextResponse.json({
    id: job.id,
    analysisId: job.analysisId,
    kind: job.kind,
    status: job.status,
    progress: job.progress,
    formats: job.formats,
    outputs: job.outputs,
    summary: job.summary,
    error: job.error,
    reverted: job.reverted,
    undoFileId: job.undoFileId,
    patchFileId: job.patchFileId,
    createdAt: job.createdAt,
    completedAt: job.completedAt,
  });
}
