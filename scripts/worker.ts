import { db } from "../src/db";
import { analyses, jobs } from "../src/db/schema";
import { and, eq, gte, isNull, lt, or } from "drizzle-orm";
import { runAnalysisJob, runApplyJob } from "../src/lib/server/jobs";

const pollMs = Math.max(250, Number(process.env.XRAY_WORKER_POLL_MS ?? 1000));
const batchSize = Math.max(1, Math.min(20, Number(process.env.XRAY_WORKER_BATCH_SIZE ?? 4)));
const configuredStaleMs = Number(process.env.XRAY_JOB_STALE_MS ?? 300_000);
const staleMs = Number.isFinite(configuredStaleMs)
  ? Math.max(60_000, Math.min(3_600_000, configuredStaleMs))
  : 300_000;
// Attempts are incremented only when a queued record is atomically claimed.
// A crash can therefore trigger at most three total executions per work item.
const MAX_ATTEMPTS = 3;
let stopping = false;
let preferApply = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`X-RAY worker online (poll=${pollMs}ms, batch=${batchSize})`);
  while (!stopping) {
    try {
      // Requeue work abandoned by a crashed request process or worker. A live
      // runner refreshes heartbeatAt independently while parsing/exporting.
      const staleBefore = new Date(Date.now() - staleMs);
      const staleAnalysis = and(
        eq(analyses.status, "processing"),
        or(lt(analyses.heartbeatAt, staleBefore), and(isNull(analyses.heartbeatAt), lt(analyses.createdAt, staleBefore)))
      );
      const staleJob = and(
        eq(jobs.status, "running"),
        or(lt(jobs.heartbeatAt, staleBefore), and(isNull(jobs.heartbeatAt), lt(jobs.createdAt, staleBefore)))
      );
      const [recoveredAnalyses, recoveredJobs, failedAnalyses, failedJobs] = await Promise.all([
        db.update(analyses)
          .set({ status: "queued", statusText: "Recovered after stale worker heartbeat", heartbeatAt: null, error: null })
          .where(and(staleAnalysis, lt(analyses.attempts, MAX_ATTEMPTS)))
          .returning({ id: analyses.id }),
        db.update(jobs)
          .set({ status: "queued", progress: 0, error: "Recovered after stale worker heartbeat", heartbeatAt: null })
          .where(and(staleJob, lt(jobs.attempts, MAX_ATTEMPTS)))
          .returning({ id: jobs.id }),
        db.update(analyses)
          .set({ status: "failed", statusText: "Worker stopped responding; retry limit reached", error: "JOB_RETRY_LIMIT_EXCEEDED", heartbeatAt: null, completedAt: new Date() })
          .where(and(staleAnalysis, gte(analyses.attempts, MAX_ATTEMPTS)))
          .returning({ id: analyses.id }),
        db.update(jobs)
          .set({ status: "failed", error: "JOB_RETRY_LIMIT_EXCEEDED", heartbeatAt: null, completedAt: new Date() })
          .where(and(staleJob, gte(jobs.attempts, MAX_ATTEMPTS)))
          .returning({ id: jobs.id }),
      ]);
      if (recoveredAnalyses.length || recoveredJobs.length || failedAnalyses.length || failedJobs.length) {
        console.warn("Recovered stale X-RAY work", {
          analyses: recoveredAnalyses.length,
          applyJobs: recoveredJobs.length,
          failedAnalyses: failedAnalyses.length,
          failedApplyJobs: failedJobs.length,
        });
      }
      const [queuedAnalyses, queuedJobs] = await Promise.all([
        db.select({ id: analyses.id }).from(analyses).where(eq(analyses.status, "queued")).limit(batchSize),
        db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "queued")).limit(batchSize),
      ]);
      if (!queuedAnalyses.length && !queuedJobs.length) {
        await sleep(pollMs);
        continue;
      }
      // batchSize is a total concurrency cap, not a per-queue cap: workbook
      // parsing is memory-heavy, so running batchSize analyses PLUS batchSize
      // exports could double the intended peak memory. Alternate queue priority
      // to avoid starving exports (or analyses) under a sustained backlog.
      const candidates = [
        ...(preferApply
          ? queuedJobs.map(({ id }) => ({ kind: "apply" as const, id }))
          : queuedAnalyses.map(({ id }) => ({ kind: "analysis" as const, id }))),
        ...(preferApply
          ? queuedAnalyses.map(({ id }) => ({ kind: "analysis" as const, id }))
          : queuedJobs.map(({ id }) => ({ kind: "apply" as const, id }))),
      ].slice(0, batchSize);
      preferApply = !preferApply;

      // Runners claim records atomically; safe if multiple workers or the
      // request process observe the same queued row at the same time.
      await Promise.all(candidates.map(({ kind, id }) =>
        kind === "analysis" ? runAnalysisJob(id) : runApplyJob(id)
      ));
    } catch (error) {
      console.error("X-RAY worker loop failed; retrying", error);
      await sleep(pollMs);
    }
  }
  console.log("X-RAY worker stopped");
}

main().catch((error) => {
  console.error("X-RAY worker fatal error", error);
  process.exitCode = 1;
});
