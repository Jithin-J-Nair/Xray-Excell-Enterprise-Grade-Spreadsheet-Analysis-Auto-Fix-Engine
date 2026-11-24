import { db } from "@/db";
import { sql } from "drizzle-orm";
import { assertStorageWritable } from "@/lib/server/storage";

export const dynamic = "force-dynamic";

/**
 * Readiness probe — database reachable and data directory writable.
 * Use this (not /api/health) for load-balancer / k8s readiness.
 */
export async function GET() {
  try {
    await db.execute(sql`select 1`);
    await assertStorageWritable();
    return Response.json({ ok: true, probe: "ready", database: true, storage: true });
  } catch {
    return Response.json(
      { ok: false, probe: "ready", database: false, storage: false },
      { status: 503 }
    );
  }
}
