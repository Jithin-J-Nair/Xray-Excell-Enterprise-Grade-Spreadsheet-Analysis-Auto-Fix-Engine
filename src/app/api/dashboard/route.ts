import { NextResponse } from "next/server";
import { db } from "@/db";
import { analyses, auditLogs, customRules, files, jobs, uploads } from "@/db/schema";
import { desc, sql } from "drizzle-orm";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const recent = await db
      .select({
        id: analyses.id,
        name: analyses.name,
        status: analyses.status,
        progress: analyses.progress,
        mode: analyses.mode,
        createdAt: analyses.createdAt,
        riskScore: sql<number | null>`(result->'metrics'->>'riskScore')::int`,
        healthScore: sql<number | null>`(result->'metrics'->>'healthScore')::int`,
        riskCount: sql<number | null>`coalesce(jsonb_array_length(result->'risks'), 0)`,
        formulaCount: sql<number | null>`(result->'metrics'->>'formulas')::int`,
      })
      .from(analyses)
      .orderBy(desc(analyses.createdAt))
      .limit(20);

    const [stats] = await db
      .select({
        totalAnalyses: sql<number>`count(*)::int`,
        completed: sql<number>`count(*) filter (where status = 'completed')::int`,
        avgHealth: sql<number | null>`round(avg((result->'metrics'->>'healthScore')::numeric) filter (where status = 'completed'))::int`,
        worstHealth: sql<number | null>`min((result->'metrics'->>'healthScore')::int) filter (where status = 'completed')`,
        totalRisks: sql<number>`coalesce(sum(jsonb_array_length(result->'risks')) filter (where status = 'completed'), 0)::int`,
        totalFormulas: sql<number>`coalesce(sum((result->'metrics'->>'formulas')::numeric) filter (where status = 'completed'), 0)::int`,
      })
      .from(analyses);

    const [jobStats] = await db
      .select({
        applied: sql<number>`count(*) filter (where kind = 'apply' and status = 'completed')::int`,
        reverted: sql<number>`count(*) filter (where kind = 'apply' and reverted)::int`,
      })
      .from(jobs);

    const [fileStats] = await db
      .select({
        uploadsCount: sql<number>`coalesce((select count(*) from ${uploads}), 0)::int`,
        exportsCount: sql<number>`count(*) filter (where kind = 'export')::int`,
        bytesProcessed: sql<number>`coalesce(sum(size) filter (where kind = 'original'), 0)::int`,
      })
      .from(files);

    const audits = await db.select().from(auditLogs).orderBy(desc(auditLogs.createdAt)).limit(12);
    const rulesCount = await db.select({ n: sql<number>`count(*)::int` }).from(customRules);

    return NextResponse.json({
      stats: {
        ...stats,
        ...jobStats,
        ...fileStats,
        customRules: rulesCount[0]?.n ?? 0,
      },
      recent,
      audits: audits.map((a) => ({ id: a.id, action: a.action, detail: a.detail, at: a.createdAt })),
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Likely schema not yet pushed — return zeros so the UI still renders.
    return NextResponse.json({
      stats: { totalAnalyses: 0, completed: 0, avgHealth: null, worstHealth: null, totalRisks: 0, totalFormulas: 0, applied: 0, reverted: 0, uploadsCount: 0, exportsCount: 0, bytesProcessed: 0, customRules: 0 },
      recent: [],
      audits: [],
      notice: message,
    });
  }
}
