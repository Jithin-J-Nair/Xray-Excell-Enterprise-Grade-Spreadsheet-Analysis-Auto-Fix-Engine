import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs, previews } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { AnalysisResult } from "@/lib/excel/types";
import { allModels, rescoreModel } from "@/lib/excel/analyze";
import { applyTransforms, TOOLS } from "@/lib/excel/transform";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const VALID_IDS = new Set(TOOLS.map((t) => t.id));

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  try {
    const body = (await req.json()) as { tools?: string[]; options?: { minOccurrences?: number } };
    const tools = (body.tools ?? []).filter((t) => VALID_IDS.has(t));
    const options = { minOccurrences: Math.max(2, Math.min(50, body.options?.minOccurrences ?? 3)) };
    const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
    if (!row) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found", retryable: false }, { status: 404 });
    if (row.status !== "completed" || !row.result) {
      return NextResponse.json({ errorCode: "NOT_READY", message: "Analysis has not completed yet", retryable: true }, { status: 409 });
    }
    const result = row.result as unknown as AnalysisResult;
    const models = allModels(result);
    const language = (result.language ?? "en") as "en" | "jp";

    const before = models[0] ? rescoreModel(models[0], { language }) : 0;
    const { diffs, summary } = applyTransforms(models, tools, options);
    // re-score a copy with same tools applied to measure real risk delta
    const { models: patched } = applyTransforms(models, tools, options);
    const after = patched[0] ? rescoreModel(patched[0], { language }) : before;
    summary.riskScoreBefore = before;
    summary.riskScoreAfter = after;
    summary.risksResolved = Math.max(0, before - after);

    const [preview] = await db
      .insert(previews)
      .values({ analysisId: id, tools, options, summary, diffs })
      .returning();
    await db.insert(auditLogs).values({
      analysisId: id,
      action: "preview.created",
      detail: { previewId: preview.id, tools, diffs: diffs.length, riskDelta: `${before}→${after}` },
    });
    return NextResponse.json({ previewId: preview.id, diffs, summary });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "PREVIEW_FAILED", message, retryable: true, details: message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const rows = await db.select().from(previews).where(eq(previews.analysisId, id));
  return NextResponse.json({
    previews: rows
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 10)
      .map((p) => ({ id: p.id, tools: p.tools, summary: p.summary, createdAt: p.createdAt, diffs: p.diffs })),
  });
}
