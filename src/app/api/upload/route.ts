import { NextRequest, NextResponse } from "next/server";
import { db } from "@/db";
import { files, uploads, auditLogs } from "@/db/schema";
import { MAX_FILE_BYTES, saveBytes, sanitizeFileName, sha256 } from "@/lib/server/storage";
import { isSupportedFile, supportedExtensions } from "@/lib/excel/parse";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  xlsb: "application/vnd.ms-excel.sheet.binary.macroEnabled.12",
  csv: "text/csv",
  tsv: "text/tab-separated-values",
  txt: "text/plain",
  json: "application/json",
  ndjson: "application/x-ndjson",
};

function mimeOf(name: string): string {
  const ext = name.split(".").pop()?.toLowerCase() ?? "";
  return MIME_BY_EXT[ext] ?? "application/octet-stream";
}

export async function POST(req: NextRequest) {
  try {
    const contentLength = Number(req.headers.get("content-length") ?? 0);
    const maxRequestBytes = MAX_FILE_BYTES * 2 + 1024 * 1024;
    if (contentLength > maxRequestBytes) {
      return NextResponse.json({ errorCode: "BATCH_TOO_LARGE", message: "Combined upload exceeds the 2-file-size batch budget", retryable: false }, { status: 413 });
    }
    const form = await req.formData();
    const entries = form.getAll("files").filter((f): f is File => f instanceof File);
    if (!entries.length) {
      return NextResponse.json({ errorCode: "NO_FILES", message: "No files provided in 'files[]'", retryable: false }, { status: 400 });
    }
    if (entries.length > 12) {
      return NextResponse.json({ errorCode: "TOO_MANY_FILES", message: "Batch limited to 12 files", retryable: false }, { status: 400 });
    }
    for (const f of entries) {
      if (!isSupportedFile(f.name)) {
        return NextResponse.json(
          { errorCode: "UNSUPPORTED_FORMAT", message: `Unsupported format: ${f.name}. Supported: ${supportedExtensions().join(", ")}`, retryable: false },
          { status: 415 }
        );
      }
      if (f.size > MAX_FILE_BYTES) {
        return NextResponse.json(
          { errorCode: "FILE_TOO_LARGE", message: `${f.name} exceeds the ${Math.round(MAX_FILE_BYTES / 1024 / 1024)}MB limit`, retryable: false },
          { status: 413 }
        );
      }
    }

    const totalBytes = entries.reduce((sum, file) => sum + file.size, 0);
    if (totalBytes > MAX_FILE_BYTES * 2) {
      return NextResponse.json({ errorCode: "BATCH_TOO_LARGE", message: "Combined upload exceeds the 2-file-size batch budget", retryable: false }, { status: 413 });
    }

    const name = entries.length === 1 ? entries[0].name : `${entries[0].name} +${entries.length - 1}`;
    const [upload] = await db.insert(uploads).values({ name, fileCount: entries.length }).returning();

    const out: { id: string; name: string; size: number }[] = [];
    for (const f of entries) {
      const bytes = new Uint8Array(await f.arrayBuffer());
      const saved = await saveBytes("uploads", upload.id, sanitizeFileName(f.name), bytes);
      const [row] = await db
        .insert(files)
        .values({
          uploadId: upload.id,
          kind: "original",
          name: f.name,
          size: f.size,
          mime: mimeOf(f.name),
          path: saved.relPath,
          sha256: sha256(bytes),
        })
        .returning();
      out.push({ id: row.id, name: row.name, size: row.size });
    }

    await db.insert(auditLogs).values({
      analysisId: null,
      action: "upload.created",
      detail: { uploadId: upload.id, files: out.map((o) => o.name) },
    });

    return NextResponse.json({ uploadId: upload.id, files: out, status: "stored" });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "UPLOAD_FAILED", message, retryable: true }, { status: 500 });
  }
}
