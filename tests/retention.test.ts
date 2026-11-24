import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { retentionCutoff, retentionDays } from "../src/lib/server/retention";

describe("data retention policy", () => {
  it("defaults to 30 days and clamps invalid env values", () => {
    assert.equal(retentionDays(undefined), 30);
    assert.equal(retentionDays("0"), 30);
    assert.equal(retentionDays("-3"), 30);
    assert.equal(retentionDays("nope"), 30);
    assert.equal(retentionDays("90"), 90);
    assert.equal(retentionDays("99999"), 3650);
  });

  it("computes a cutoff relative to now", () => {
    const now = new Date("2026-11-24T00:00:00.000Z");
    const cutoff = retentionCutoff(now, 30);
    assert.equal(cutoff.toISOString(), "2026-10-25T00:00:00.000Z");
  });
});
