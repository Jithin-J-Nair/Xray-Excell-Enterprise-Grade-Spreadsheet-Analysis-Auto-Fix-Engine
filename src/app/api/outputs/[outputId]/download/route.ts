import { NextRequest } from "next/server";
import { createReadStream } from "fs";
import { existsSync } from "fs";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq } from "drizzle-orm";
import { absOf } from "@/lib/server/storage";
import { Readable } from "stream";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MIME_BY_EXT: Record<string, string> = {
  xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  csv: "text/csv; charset=utf-8",
  json: "application/json; charset=utf-8",
  ndjson: "application/x-ndjson; charset=utf-8",
  md: "text/markdown; charset=utf-8",
};

export function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

/**
 * GET /api/outputs/:outputId/download — streams a generated export file.
 * `outputId` is the id of a row in the outputs registry (files table).
 * Returns binary (never JSON on success) with no-store caching.
 */
export async function GET(_req: NextRequest, ctx: { params: Promise<{ outputId: string }> }) {
  const { outputId } = await ctx.params;
  const [file] = await db.select().from(files).where(eq(files.id, outputId)).limit(1);
  if (!file) {
    return Response.json({ errorCode: "OUTPUT_NOT_FOUND", message: "Output not found", retryable: false }, { status: 404 });
  }
  const abs = absOf(file.path);
  if (!existsSync(abs)) {
    return Response.json(
      { errorCode: "OUTPUT_GONE", message: "File was purged from storage (retention elapsed?)", retryable: false },
      { status: 410 }
    );
  }
  const ext = file.name.split(".").pop()?.toLowerCase() ?? "";
  const contentType = file.mime && file.mime !== "application/octet-stream" ? file.mime : (MIME_BY_EXT[ext] ?? "application/octet-stream");
  const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
  return new Response(stream, {
    status: 200,
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": contentDisposition(file.name),
      "Content-Length": String(file.size),
      "Cache-Control": "no-store",
      "X-Content-SHA256": file.sha256 ?? "",
    },
  });
}
