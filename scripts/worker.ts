import { db } from "../src/db";
import { analyses, jobs } from "../src/db/schema";
import { eq } from "drizzle-orm";
import { runAnalysisJob, runApplyJob } from "../src/lib/server/jobs";

const pollMs = Math.max(250, Number(process.env.XRAY_WORKER_POLL_MS ?? 1000));
const batchSize = Math.max(1, Math.min(20, Number(process.env.XRAY_WORKER_BATCH_SIZE ?? 4)));
let stopping = false;

process.on("SIGINT", () => { stopping = true; });
process.on("SIGTERM", () => { stopping = true; });

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

async function main() {
  console.log(`X-RAY worker online (poll=${pollMs}ms, batch=${batchSize})`);
  while (!stopping) {
    try {
      const [queuedAnalyses, queuedJobs] = await Promise.all([
        db.select({ id: analyses.id }).from(analyses).where(eq(analyses.status, "queued")).limit(batchSize),
        db.select({ id: jobs.id }).from(jobs).where(eq(jobs.status, "queued")).limit(batchSize),
      ]);
      if (!queuedAnalyses.length && !queuedJobs.length) {
        await sleep(pollMs);
        continue;
      }
      // Runners claim records atomically; safe if multiple workers or the
      // request process observe the same queued row at the same time.
      await Promise.all([
        ...queuedAnalyses.map(({ id }) => runAnalysisJob(id)),
        ...queuedJobs.map(({ id }) => runApplyJob(id)),
      ]);
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
