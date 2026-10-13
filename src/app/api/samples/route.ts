import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { auditLogs, files, uploads } from "@/db/schema";
import { saveBytes, sha256 } from "@/lib/server/storage";
import { SAMPLES } from "@/lib/excel/samples";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Generate a demo messy workbook on demand and register it as an upload. */
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json().catch(() => ({}))) as { kind?: string };
    const sample = SAMPLES.find((s) => s.kind === body.kind) ?? SAMPLES[0];
    const bytes = sample.bytes();
    const [upload] = await db.insert(uploads).values({ name: sample.fileName, fileCount: 1 }).returning();
    const saved = await saveBytes("uploads", upload.id, sample.fileName, bytes);
    const [row] = await db
      .insert(files)
      .values({
        uploadId: upload.id,
        kind: "original",
        name: sample.fileName,
        size: bytes.length,
        mime: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        path: saved.relPath,
        sha256: sha256(bytes),
        meta: { sample: sample.kind, generated: true },
      })
      .returning();
    await db.insert(auditLogs).values({
      analysisId: null,
      action: "sample.generated",
      detail: { kind: sample.kind, uploadId: upload.id, name: sample.fileName },
    });
    return NextResponse.json({ uploadId: upload.id, files: [{ id: row.id, name: row.name, size: row.size }], status: "stored" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "SAMPLE_FAILED", message, retryable: true }, { status: 500 });
  }
}
