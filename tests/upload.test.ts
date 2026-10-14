import { describe, it, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import path from "path";
import { sql, eq } from "drizzle-orm";

process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

describe("POST /api/upload duplicate-name safety", () => {
  let uploadId = "";
  let db: typeof import("../src/db/index").db;
  let files: typeof import("../src/db/schema").files;
  let uploads: typeof import("../src/db/schema").uploads;
  let auditLogs: typeof import("../src/db/schema").auditLogs;
  let absOf: typeof import("../src/lib/server/storage").absOf;

  after(async () => {
    if (!db) return;
    if (uploadId) {
      await db.delete(files).where(eq(files.uploadId, uploadId));
      await db.delete(auditLogs).where(sql`${auditLogs.detail}->>'uploadId' = ${uploadId}`);
      await db.delete(uploads).where(eq(uploads.id, uploadId));
      if (absOf) await fs.rm(absOf(path.join("uploads", uploadId)), { recursive: true, force: true });
    }
  });

  it("stores same-named files as distinct bytes and rows", async () => {
    const database = await import("../src/db/index");
    const schema = await import("../src/db/schema");
    const storage = await import("../src/lib/server/storage");
    db = database.db;
    files = schema.files;
    uploads = schema.uploads;
    auditLogs = schema.auditLogs;
    absOf = storage.absOf;

    const form = new FormData();
    form.append("files", new File(["first-content"], "duplicate.txt", { type: "text/plain" }));
    form.append("files", new File(["second-content"], "duplicate.txt", { type: "text/plain" }));
    const route = await import("../src/app/api/upload/route");
    const response = await route.POST(new Request("http://localhost/api/upload", { method: "POST", body: form }) as never);
    if (response.status !== 200) assert.fail(`Upload returned ${response.status}: ${await response.text()}`);
    const body = await response.json() as { uploadId: string; files: Array<{ name: string; size: number }> };
    uploadId = body.uploadId;
    assert.equal(body.files.length, 2);

    const rows = await db.select().from(files).where(eq(files.uploadId, uploadId));
    assert.equal(rows.length, 2);
    assert.notEqual(rows[0].path, rows[1].path, "duplicate filenames must not overwrite physical bytes");
    const storageBytes = await Promise.all(rows.map((row) => storage.readBytes(row.path)));
    assert.deepEqual(storageBytes.map((bytes) => bytes.toString()).sort(), ["first-content", "second-content"]);
  });
});
