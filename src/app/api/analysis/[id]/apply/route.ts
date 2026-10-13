import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs, jobs, previews } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runApplyJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_FORMATS = new Set(["xlsx", "csv", "json", "ndjson", "md"]);

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as {
      previewId?: string;
      exportFormats?: string[];
      localRecord?: boolean;
      tools?: string[];
      summary?: Record<string, unknown>;
      language?: "en" | "jp";
    };
    const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
    if (!row) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found", retryable: false }, { status: 404 });
    if (row.status !== "completed") {
      return NextResponse.json({ errorCode: "NOT_READY", message: "Analysis has not completed yet", retryable: true }, { status: 409 });
    }

    // Local/private mode: the client applied transforms & wrote the file in-browser.
    // We only record the audit trail + a completed "apply record" job.
    if (body.localRecord) {
      const [job] = await db
        .insert(jobs)
        .values({
          analysisId: id,
          kind: "apply",
          status: "completed",
          progress: 100,
          formats: body.exportFormats ?? ["xlsx"],
          summary: body.summary ?? {},
          completedAt: new Date(),
        })
        .returning();
      await db.insert(auditLogs).values({
        analysisId: id,
        action: "apply.recorded",
        detail: { mode: "local", jobId: job.id, tools: body.tools ?? [], summary: body.summary ?? {} },
      });
      return NextResponse.json({ jobId: job.id, status: "completed", mode: "local" });
    }

    if (!body.previewId) {
      return NextResponse.json({ errorCode: "BAD_REQUEST", message: "previewId is required", retryable: false }, { status: 400 });
    }
    const [preview] = await db.select().from(previews).where(eq(previews.id, body.previewId)).limit(1);
    if (!preview || preview.analysisId !== id) {
      return NextResponse.json({ errorCode: "PREVIEW_NOT_FOUND", message: "Preview not found for this analysis", retryable: false }, { status: 404 });
    }
    const formats = (body.exportFormats ?? ["xlsx"]).filter((f) => VALID_FORMATS.has(f));
    if (!formats.length) {
      return NextResponse.json({ errorCode: "BAD_FORMAT", message: "At least one valid export format is required", retryable: false }, { status: 400 });
    }
    const [job] = await db
      .insert(jobs)
      .values({ analysisId: id, previewId: preview.id, kind: "apply", status: "queued", progress: 0, formats })
      .returning();
    await db.insert(auditLogs).values({ analysisId: id, action: "apply.queued", detail: { jobId: job.id, previewId: preview.id, formats } });
    void runApplyJob(job.id).catch((e) => console.error("runApplyJob", e));
    return NextResponse.json({ jobId: job.id, status: "queued" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "APPLY_FAILED", message, retryable: true, details: message }, { status: 500 });
  }
}
