import { describe, it } from "node:test";
import assert from "node:assert/strict";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

describe("health probes", () => {
  it("liveness does not require the database", async () => {
    const { GET } = await import("../src/app/api/health/route");
    const response = await GET();
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { ok: true, probe: "live" });
  });

  it("readiness reports database and storage when available", async () => {
    const { GET } = await import("../src/app/api/ready/route");
    const response = await GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.ok, true);
    assert.equal(body.probe, "ready");
    assert.equal(body.database, true);
    assert.equal(body.storage, true);
  });
});
