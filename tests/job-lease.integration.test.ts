import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

describe("database fencing-token lease", () => {
  let db: typeof import("../src/db/index").db;
  let jobs: typeof import("../src/db/schema").jobs;
  let and: typeof import("drizzle-orm").and;
  let eq: typeof import("drizzle-orm").eq;
  let jobId = "";

  before(async () => {
    db = (await import("../src/db/index")).db;
    jobs = (await import("../src/db/schema")).jobs;
    const drizzle = await import("drizzle-orm");
    and = drizzle.and;
    eq = drizzle.eq;
    const [job] = await db.insert(jobs).values({
      analysisId: null,
      previewId: null,
      kind: "apply",
      status: "queued",
      formats: [],
    }).returning();
    jobId = job.id;
  });

  after(async () => {
    if (jobId) await db.delete(jobs).where(eq(jobs.id, jobId));
  });

  it("allows only one atomic claim and fences a stale worker after reclamation", async () => {
    const firstToken = randomUUID();
    const secondToken = randomUUID();
    const claim = (token: string) => db.update(jobs)
      .set({ status: "running", leaseToken: token, heartbeatAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
      .returning({ id: jobs.id });

    const claims = await Promise.all([claim(firstToken), claim(secondToken)]);
    assert.equal(claims.reduce((count, result) => count + result.length, 0), 1, "exactly one concurrent worker should claim the queued job");
    const [owner] = await db.select({ leaseToken: jobs.leaseToken }).from(jobs).where(eq(jobs.id, jobId)).limit(1);
    assert.ok(owner?.leaseToken === firstToken || owner?.leaseToken === secondToken);

    // Simulate stale-job recovery revoking the first lease and returning the job to the queue.
    await db.update(jobs).set({ status: "queued", leaseToken: null, heartbeatAt: null })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, owner.leaseToken!)));
    const staleToken = owner.leaseToken!;
    const [reclaimed] = await db.update(jobs)
      .set({ status: "running", leaseToken: secondToken, heartbeatAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "queued")))
      .returning({ id: jobs.id });
    assert.ok(reclaimed, "a successor should claim the recovered job");

    const stalePublish = await db.update(jobs)
      .set({ status: "completed", leaseToken: null, completedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, staleToken)))
      .returning({ id: jobs.id });
    assert.equal(stalePublish.length, 0, "the stale worker must not publish after its lease was revoked");

    const currentPublish = await db.update(jobs)
      .set({ status: "completed", leaseToken: null, completedAt: new Date() })
      .where(and(eq(jobs.id, jobId), eq(jobs.status, "running"), eq(jobs.leaseToken, secondToken)))
      .returning({ id: jobs.id });
    assert.equal(currentPublish.length, 1, "only the current lease owner can publish");
  });
});
