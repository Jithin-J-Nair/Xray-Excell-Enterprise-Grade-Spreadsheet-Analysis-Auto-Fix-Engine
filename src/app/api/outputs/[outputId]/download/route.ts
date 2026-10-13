import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq } from "drizzle-orm";
import { absOf } from "@/lib/server/storage";
import { Readable } from "node:stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  xlsm: "application/vnd.ms-excel.sheet.macroEnabled.12",
  xls: "application/vnd.ms-excel",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/["\\]/g, "_");
  const encoded = encodeURIComponent(name).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/outputs/:outputId/download — streams a generated export file.
 * The response length is taken from the physical file, not cached DB metadata,
 * so stale metadata cannot cause clients to truncate or wait for the response.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await ctx.params;
  const [file] = await db.select().from(files).where(eq(files.id, outputId)).limit(1);

  if (!file) {
    return Response.json(
      { errorCode: "OUTPUT_NOT_FOUND", message: "Output not found", retryable: false },
      { status: 404 }
    );
  }

  const abs = absOf(file.path);
  let fileStat;
  try {
    fileStat = await stat(abs);
  } catch (error) {
    const code = (error as NodeJS.ErrnoException).code;
    if (code === "ENOENT" || code === "ENOTDIR") {
      return Response.json(
        { errorCode: "OUTPUT_GONE", message: "Export file is missing from storage", retryable: false },
        { status: 410 }
      );
    }
    return Response.json(
      { errorCode: "OUTPUT_READ_FAILED", message: "Unable to access the export file", retryable: true },
      { status: 500 }
    );
  }

  if (!fileStat.isFile()) {
    return Response.json(
      { errorCode: "OUTPUT_INVALID", message: "Export path is not a regular file", retryable: false },
      { status: 500 }
    );
  }

  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  // Known export extensions are authoritative; a stale/mistyped DB MIME
  // must not cause XLSX bytes to be served as JSON or generic binary.
  const contentType =
    MIME_BY_EXT[ext] ??
    (file.mime && file.mime !== "application/octet-stream" ? file.mime : "application/octet-stream");

  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(file.name),
      "Content-Length": String(fileStat.size),
      "Cache-Control": "no-store",
      "X-Content-SHA256": file.sha256 ?? "",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
