export const dynamic = "force-dynamic";

/**
 * Liveness probe — process is up. Does not touch the database or storage so a
 * transient dependency outage cannot trigger unnecessary pod restarts.
 */
export async function GET() {
  return Response.json({ ok: true, probe: "live" });
}
