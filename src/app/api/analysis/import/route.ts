import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs } from "@/db/schema";
import type { AnalysisResult } from "@/lib/excel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Local (private) mode: the file was parsed AND analyzed in the browser with the
 * same isomorphic engine. Only the analysis JSON is stored — original bytes
 * never leave the client machine.
 */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { name?: string; language?: "en" | "jp"; result?: AnalysisResult };
    const result = body.result;
    if (!result || !result.metrics || !result.model) {
      return NextResponse.json({ errorCode: "BAD_RESULT", message: "A valid analysis result payload is required", retryable: false }, { status: 400 });
    }
    if (result.model.truncated) {
      return NextResponse.json({ errorCode: "MODEL_TRUNCATED", message: "Incomplete workbook models cannot be imported or exported", retryable: false }, { status: 422 });
    }
    const size = new TextEncoder().encode(JSON.stringify(result)).byteLength;
    if (size > 30 * 1024 * 1024) {
      return NextResponse.json({ errorCode: "RESULT_TOO_LARGE", message: "Analysis payload exceeds 30MB", retryable: false }, { status: 413 });
    }
    result.language = body.language === "jp" ? "jp" : result.language ?? "en";
    const name = body.name || result.name || "local analysis";
    const [row] = await db
      .insert(analyses)
      .values({
        uploadId: null,
        name,
        mode: "local",
        options: { resolveCrossFile: true, language: result.language },
        status: "completed",
        progress: 100,
        statusText: "Completed (local)",
        result,
        completedAt: new Date(),
        log: [{ t: new Date().toISOString(), msg: "local: parsed & analyzed in-browser — bytes never uploaded" }],
      })
      .returning();
    await db.insert(auditLogs).values({ analysisId: row.id, action: "analysis.imported", detail: { name, mode: "local", risks: result.risks?.length ?? 0 } });
    return NextResponse.json({ analysisId: row.id, status: "completed" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "IMPORT_FAILED", message, retryable: true }, { status: 500 });
  }
}
