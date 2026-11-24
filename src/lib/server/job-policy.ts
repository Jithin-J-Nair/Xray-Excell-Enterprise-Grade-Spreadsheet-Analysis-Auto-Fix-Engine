export const MAX_JOB_ATTEMPTS = 3;

/** Job kinds the durable worker can reclaim and re-run. Request-scoped kinds are excluded. */
export const DURABLE_WORKER_JOB_KINDS = ["apply"] as const;

export type StaleJobDisposition = "retry" | "fail";

/**
 * Stale work is retried only while fewer than MAX_JOB_ATTEMPTS claims have
 * occurred. A claim increments attempts before execution, so three means
 * three total executions, not three retries plus the first attempt.
 */
export function staleJobDisposition(attempts: number, maxAttempts = MAX_JOB_ATTEMPTS): StaleJobDisposition {
  if (!Number.isSafeInteger(attempts) || attempts < 0) {
    throw new Error("INVALID_JOB_ATTEMPTS: attempts must be a non-negative safe integer.");
  }
  if (!Number.isSafeInteger(maxAttempts) || maxAttempts < 1) {
    throw new Error("INVALID_JOB_RETRY_LIMIT: maxAttempts must be a positive safe integer.");
  }
  return attempts < maxAttempts ? "retry" : "fail";
}

/** True when the durable worker owns reclaim/retry for this jobs.kind value. */
export function isDurableWorkerJobKind(kind: string): boolean {
  return (DURABLE_WORKER_JOB_KINDS as readonly string[]).includes(kind);
}
