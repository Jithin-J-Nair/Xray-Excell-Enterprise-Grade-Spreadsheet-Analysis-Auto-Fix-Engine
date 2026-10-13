import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, uploads, auditLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import { runAnalysisJob } from "@/lib/server/jobs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      uploadId?: string;
      options?: { resolveCrossFile?: boolean; language?: "en" | "jp"; name?: string };
    };
    if (!body.uploadId) {
      return NextResponse.json({ errorCode: "BAD_REQUEST", message: "uploadId is required", retryable: false }, { status: 400 });
    }
    const [upload] = await db.select().from(uploads).where(eq(uploads.id, body.uploadId)).limit(1);
    if (!upload) {
      return NextResponse.json({ errorCode: "UPLOAD_NOT_FOUND", message: "Upload not found", retryable: false }, { status: 404 });
    }
    const options = {
      resolveCrossFile: body.options?.resolveCrossFile !== false,
      language: body.options?.language === "jp" ? ("jp" as const) : ("en" as const),
      name: body.options?.name ?? upload.name,
    };
    const [row] = await db
      .insert(analyses)
      .values({ uploadId: upload.id, name: options.name, mode: "server", options, status: "queued", progress: 0, statusText: "Queued" })
      .returning();
    await db.insert(auditLogs).values({ analysisId: row.id, action: "analysis.started", detail: { uploadId: upload.id, options } });
    void runAnalysisJob(row.id).catch((e) => console.error("runAnalysisJob", e));
    return NextResponse.json({ analysisId: row.id, status: "queued" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "ANALYSIS_START_FAILED", message, retryable: true }, { status: 500 });
  }
}
