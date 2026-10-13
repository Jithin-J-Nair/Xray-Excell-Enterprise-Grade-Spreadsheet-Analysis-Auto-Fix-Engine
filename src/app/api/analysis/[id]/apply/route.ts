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
    const raw: unknown = await req.json();
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      return NextResponse.json({ errorCode: "BAD_REQUEST", message: "Request body must be an object", retryable: false }, { status: 400 });
    }
    const body = raw as {
      previewId?: unknown;
      exportFormats?: unknown;
      localRecord?: unknown;
      tools?: unknown;
      summary?: unknown;
      language?: unknown;
    };
    if (body.exportFormats !== undefined && (!Array.isArray(body.exportFormats) || body.exportFormats.some((f) => typeof f !== "string"))) {
      return NextResponse.json({ errorCode: "BAD_FORMAT", message: "exportFormats must be an array of format IDs", retryable: false }, { status: 400 });
    }
    if (body.tools !== undefined && (!Array.isArray(body.tools) || body.tools.some((t) => typeof t !== "string"))) {
      return NextResponse.json({ errorCode: "BAD_TOOLS", message: "tools must be an array of rule IDs", retryable: false }, { status: 400 });
    }
    if (body.localRecord !== undefined && typeof body.localRecord !== "boolean") {
      return NextResponse.json({ errorCode: "BAD_REQUEST", message: "localRecord must be boolean", retryable: false }, { status: 400 });
    }
    const requestedFormats = (body.exportFormats as string[] | undefined) ?? ["xlsx"];
    const formats = [...new Set(requestedFormats.filter((f) => VALID_FORMATS.has(f)))];
    if (formats.length === 0 || formats.length !== requestedFormats.length) {
      return NextResponse.json({ errorCode: "BAD_FORMAT", message: "Provide one or more supported export formats: xlsx, csv, json, ndjson, md", retryable: false }, { status: 400 });
    }
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
          formats,
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

    if (typeof body.previewId !== "string" || !body.previewId) {
      return NextResponse.json({ errorCode: "BAD_REQUEST", message: "previewId must be a non-empty string", retryable: false }, { status: 400 });
    }
    const [preview] = await db.select().from(previews).where(eq(previews.id, body.previewId)).limit(1);
    if (!preview || preview.analysisId !== id) {
      return NextResponse.json({ errorCode: "PREVIEW_NOT_FOUND", message: "Preview not found for this analysis", retryable: false }, { status: 404 });
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
