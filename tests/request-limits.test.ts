import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { NextRequest } from "next/server";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

describe("request body size preflight", () => {
  it("rejects oversized multipart uploads before formData parsing", async () => {
    const { POST } = await import("../src/app/api/upload/route");
    const { MAX_FILE_BYTES } = await import("../src/lib/server/storage");
    let parsed = false;
    const request = {
      headers: new Headers({ "content-length": String(MAX_FILE_BYTES * 2 + 1024 * 1024 + 1) }),
      formData: async () => { parsed = true; throw new Error("should not parse"); },
    } as unknown as NextRequest;
    const response = await POST(request);
    assert.equal(response.status, 413);
    assert.equal(parsed, false);
  });

  it("rejects oversized local-analysis JSON before json parsing", async () => {
    const { POST } = await import("../src/app/api/analysis/import/route");
    let parsed = false;
    const request = {
      headers: new Headers({ "content-length": String(31 * 1024 * 1024 + 1) }),
      json: async () => { parsed = true; throw new Error("should not parse"); },
    } as unknown as NextRequest;
    const response = await POST(request);
    assert.equal(response.status, 413);
    assert.equal(parsed, false);
  });
});
