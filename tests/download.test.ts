import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { promises as fs } from "fs";
import * as XLSX from "xlsx";
import { workbookToXlsxBytes } from "../src/lib/excel/serialize";
import type { WorkbookModel } from "../src/lib/excel/types";

// Integration test for GET /api/outputs/:outputId/download (real DB + real file).
// Requires the same PostgreSQL the app uses (drizzle.config.json credentials).
process.env.DATABASE_URL = process.env.DATABASE_URL ?? "postgresql://postgres:postgres@127.0.0.1:5432/app_db";

async function loadModules() {
  const route = await import("../src/app/api/outputs/[outputId]/download/route");
  const { db } = await import("../src/db/index");
  const { files } = await import("../src/db/schema");
  const { eq } = await import("drizzle-orm");
  const { saveBytes } = await import("../src/lib/server/storage");
  return { route, db, files, eq, saveBytes };
}

describe("GET /api/outputs/:outputId/download", () => {
  let fileId = "";
  let payload: ReturnType<typeof workbookToXlsxBytes> = new Uint8Array();
  let cleanup: () => Promise<void>;

  before(async () => {
    const { db, files, eq, saveBytes } = await loadModules();
    const model: WorkbookModel = {
      fileId: "roundtrip",
      fileName: "Test Book.xlsx",
      sheets: [
        {
          name: "Data",
          visibility: "visible",
          rows: 2,
          cols: 2,
          cells: {
            A1: { a: "A1", r: 0, c: 0, t: "s", v: "Amount" },
            A2: { a: "A2", r: 1, c: 0, t: "n", v: 12.5, z: "#,##0.00" },
            B2: { a: "B2", r: 1, c: 1, t: "n", v: 25, f: "A2*2", z: "0.00" },
          },
          merges: [{ r1: 0, c1: 0, r2: 0, c2: 1 }],
        },
        {
          name: "Hidden",
          visibility: "hidden",
          rows: 1,
          cols: 1,
          cells: { A1: { a: "A1", r: 0, c: 0, t: "s", v: "kept" } },
          merges: [],
        },
      ],
      names: [],
    };
    payload = workbookToXlsxBytes(model);
    const saved = await saveBytes("exports", "test-output", "fixed_Test Book.xlsx", payload);
    const [row] = await db
      .insert(files)
      .values({
        kind: "export",
        name: "fixed_Test Book.xlsx",
        size: payload.length + 17, // intentionally stale metadata; route must use stat()
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        path: saved.relPath,
      })
      .returning();
    fileId = row.id;
    cleanup = async () => {
      await db.delete(files).where(eq(files.id, fileId));
      await fs.rm(saved.absPath, { force: true });
    };
  });

  after(async () => {
    await cleanup();
  });

  it("streams bytes with exact headers (never JSON)", async () => {
    const { route } = await loadModules();
    const req = new Request("http://localhost/api/outputs/" + fileId + "/download");
    const res = await route.GET(req as never, { params: Promise.resolve({ outputId: fileId }) });
    assert.equal(res.status, 200);
    assert.equal(
      res.headers.get("content-type"),
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
    );
    const cd = res.headers.get("content-disposition") ?? "";
    assert.ok(cd.startsWith("attachment;"), "attachment disposition");
    assert.ok(cd.includes('filename="fixed_Test Book.xlsx"'), "ascii filename present");
    assert.ok(cd.includes("filename*=UTF-8''"), "RFC5987 filename present");
    assert.equal(res.headers.get("cache-control"), "no-store");
    assert.equal(res.headers.get("content-length"), String(payload.length), "Content-Length must match physical bytes, not stale DB size");
    const buf = Buffer.from(await res.arrayBuffer());
    assert.deepEqual(buf, Buffer.from(payload), "downloaded bytes are identical to the generated XLSX");

    // Real XLSX round-trip: the downloaded response must be a readable workbook,
    // not merely a byte stream with a ZIP-like prefix.
    const reopened = XLSX.read(buf, { type: "buffer", cellNF: true });
    assert.deepEqual(reopened.SheetNames, ["Data", "Hidden"]);
    const data = reopened.Sheets.Data;
    assert.equal(data.A2.v, 12.5);
    assert.equal(data.A2.z, "#,##0.00");
    assert.equal(data.B2.f, "A2*2");
    assert.equal(data.B2.v, 25);
    assert.equal(data.B2.z, "0.00");
    assert.deepEqual(data["!merges"], [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }]);
    assert.equal(reopened.Workbook?.Sheets?.[1]?.Hidden, 1);
  });

  it("returns structured 404 JSON for unknown output ids", async () => {
    const { route } = await loadModules();
    const req = new Request("http://localhost/api/outputs/00000000-0000-0000-0000-000000000000/download");
    const res = await route.GET(req as never, {
      params: Promise.resolve({ outputId: "00000000-0000-0000-0000-000000000000" }),
    });
    assert.equal(res.status, 404);
    const json = (await res.json()) as { errorCode: string; retryable: boolean };
    assert.equal(json.errorCode, "OUTPUT_NOT_FOUND");
    assert.equal(json.retryable, false);
  });
});

describe("filename parsing (pure, mirrors the browser blob path)", () => {
  it("prefers RFC 5987 filename* then fallback filename", async () => {
    const { filenameFromDisposition } = await import("../src/lib/download");
    const cd =
      "attachment; filename=\"____.xlsx\"; filename*=UTF-8''fixed_%E5%A3%B2%E4%B8%8A.xlsx";
    assert.equal(filenameFromDisposition(cd), "fixed_売上.xlsx");
    assert.equal(filenameFromDisposition('attachment; filename="a.xlsx"'), "a.xlsx");
    assert.equal(filenameFromDisposition(null), "download");
  });
});
