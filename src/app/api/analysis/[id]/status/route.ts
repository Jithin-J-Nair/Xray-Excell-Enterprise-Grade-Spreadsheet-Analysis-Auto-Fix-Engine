import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { analyses } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { AnalysisResult } from "@/lib/excel/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const [row] = await db.select().from(analyses).where(eq(analyses.id, id)).limit(1);
  if (!row) return NextResponse.json({ errorCode: "NOT_FOUND", message: "Analysis not found" }, { status: 404 });
  const result = row.result as unknown as AnalysisResult | null;
  const log = (row.log as { t: string; msg: string }[] | null) ?? [];
  return NextResponse.json({
    status: row.status,
    progress: row.progress,
    statusText: row.statusText,
    error: row.error,
    log: log.slice(-40),
    metrics: result
      ? {
          riskScore: result.metrics.riskScore,
          healthScore: result.metrics.healthScore,
          risks: result.risks.length,
          formulas: result.metrics.formulas,
        }
      : null,
  });
}
