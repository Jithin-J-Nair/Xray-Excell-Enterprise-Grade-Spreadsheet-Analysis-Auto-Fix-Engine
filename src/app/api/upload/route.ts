import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { db } from "@/db";
import { files, uploads, auditLogs } from "@/db/schema";
import { MAX_FILE_BYTES, absOf, saveBytes, sanitizeFileName, sha256 } from "@/lib/server/storage";
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

function uniqueStoredName(rawName: string, used: Set<string>): string {
  const name = sanitizeFileName(rawName);
  const ext = path.extname(name);
  const stem = name.slice(0, name.length - ext.length);
  let candidate = name;
  let suffix = 2;
  while (used.has(candidate.toLocaleLowerCase("en-US"))) {
    const tag = ` (${suffix++})`;
    candidate = `${stem.slice(0, Math.max(1, 120 - ext.length - tag.length))}${tag}${ext}`;
  }
  used.add(candidate.toLocaleLowerCase("en-US"));
  return candidate;
}

export async function POST(req: NextRequest) {
  try {
    const contentLengthHeader = req.headers.get("content-length");
    const contentLength = contentLengthHeader === null ? 0 : Number(contentLengthHeader);
    const maxRequestBytes = MAX_FILE_BYTES * 2 + 1024 * 1024;
    if (contentLengthHeader !== null && (!Number.isSafeInteger(contentLength) || contentLength < 0)) {
      return NextResponse.json({ errorCode: "INVALID_CONTENT_LENGTH", message: "Invalid upload size header", retryable: false }, { status: 400 });
    }
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
    const uploadId = randomUUID();
    const usedNames = new Set<string>();
    const staged: Array<{ file: File; storedName: string; path: string; hash: string }> = [];

    try {
      // Stage all bytes before publishing any database rows. Unique physical
      // names prevent same-named files in one batch from overwriting each other.
      for (const file of entries) {
        const bytes = new Uint8Array(await file.arrayBuffer());
        const storedName = uniqueStoredName(file.name, usedNames);
        const saved = await saveBytes("uploads", uploadId, storedName, bytes);
        staged.push({ file, storedName, path: saved.relPath, hash: sha256(bytes) });
      }

      const out: { id: string; name: string; size: number }[] = [];
      await db.transaction(async (tx) => {
        await tx.insert(uploads).values({ id: uploadId, name, fileCount: entries.length });
        for (const item of staged) {
          const [row] = await tx.insert(files).values({
            uploadId,
            kind: "original",
            name: item.file.name,
            size: item.file.size,
            mime: mimeOf(item.file.name),
            path: item.path,
            sha256: item.hash,
          }).returning();
          out.push({ id: row.id, name: row.name, size: row.size });
        }
        await tx.insert(auditLogs).values({
          analysisId: null,
          action: "upload.created",
          detail: { uploadId, files: out.map((o) => o.name) },
        });
      });

      return NextResponse.json({ uploadId, files: out, status: "stored" });
    } catch (error) {
      // If any disk write or DB transaction fails, remove the whole private
      // upload directory so no partial batch is left behind.
      try {
        await fs.rm(absOf(path.join("uploads", uploadId)), { recursive: true, force: true });
      } catch (cleanupError) {
        console.error("upload-rollback-cleanup-failed", uploadId, cleanupError);
      }
      throw error;
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ errorCode: "UPLOAD_FAILED", message, retryable: true }, { status: 500 });
  }
}
