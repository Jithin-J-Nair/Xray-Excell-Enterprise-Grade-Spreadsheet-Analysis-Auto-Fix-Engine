export const MAX_JOB_ATTEMPTS = 3;

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
