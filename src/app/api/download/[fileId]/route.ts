import { NextRequest } from "next/server";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { Readable } from "node:stream";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq } from "drizzle-orm";
import { absOf } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function contentDisposition(name: string): string {
  const ascii = name.replace(/[^\x20-\x7e]/g, "_").replace(/"/g, "'");
  const encoded = encodeURIComponent(name).replace(/'/g, "%27");
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ fileId: string }> }) {
  const { fileId } = await ctx.params;
  const [file] = await db.select().from(files).where(eq(files.id, fileId)).limit(1);
  if (!file) {
    return Response.json({ errorCode: "NOT_FOUND", message: "File not found" }, { status: 404 });
  }
  try {
    const abs = absOf(file.path);
    const fileStat = await stat(abs);
    if (!fileStat.isFile()) {
      return Response.json({ errorCode: "INVALID_FILE", message: "Stored path is not a regular file", retryable: false }, { status: 500 });
    }
    const stream = Readable.toWeb(createReadStream(abs)) as ReadableStream<Uint8Array>;
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Length": String(fileStat.size),
        "Content-Disposition": contentDisposition(file.name),
        "Cache-Control": "no-store",
        "X-Content-SHA256": file.sha256 ?? "",
        "X-Content-Type-Options": "nosniff",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ errorCode: "READ_FAILED", message, retryable: true }, { status: 500 });
  }
}
