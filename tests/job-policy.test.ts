import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { MAX_JOB_ATTEMPTS, staleJobDisposition } from "../src/lib/server/job-policy";

describe("bounded stale-job retry policy", () => {
  it("retries only while the work item has attempts remaining", () => {
    assert.equal(MAX_JOB_ATTEMPTS, 3);
    assert.equal(staleJobDisposition(0), "retry");
    assert.equal(staleJobDisposition(1), "retry");
    assert.equal(staleJobDisposition(2), "retry");
    assert.equal(staleJobDisposition(3), "fail");
    assert.equal(staleJobDisposition(300), "fail");
  });

  it("rejects invalid attempt counters and retry limits", () => {
    assert.throws(() => staleJobDisposition(-1), /INVALID_JOB_ATTEMPTS/);
    assert.throws(() => staleJobDisposition(1.5), /INVALID_JOB_ATTEMPTS/);
    assert.throws(() => staleJobDisposition(0, 0), /INVALID_JOB_RETRY_LIMIT/);
  });
});
