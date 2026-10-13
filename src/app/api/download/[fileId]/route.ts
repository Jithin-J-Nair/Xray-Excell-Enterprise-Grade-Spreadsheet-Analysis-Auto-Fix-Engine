import { NextRequest } from "next/server";
import { db } from "@/db";
import { files } from "@/db/schema";
import { eq } from "drizzle-orm";
import { readBytes } from "@/lib/server/storage";

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
    const buf = await readBytes(file.path);
    // chunked streaming (64KB chunks) so large exports don't blow memory
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const CHUNK = 64 * 1024;
        for (let off = 0; off < buf.length; off += CHUNK) {
          controller.enqueue(new Uint8Array(buf.subarray(off, Math.min(off + CHUNK, buf.length))));
        }
        controller.close();
      },
    });
    return new Response(stream, {
      status: 200,
      headers: {
        "Content-Type": file.mime || "application/octet-stream",
        "Content-Length": String(buf.length),
        "Content-Disposition": contentDisposition(file.name),
        "Cache-Control": "no-store",
        "X-Content-SHA256": file.sha256 ?? "",
      },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    return Response.json({ errorCode: "READ_FAILED", message, retryable: true }, { status: 500 });
  }
}
