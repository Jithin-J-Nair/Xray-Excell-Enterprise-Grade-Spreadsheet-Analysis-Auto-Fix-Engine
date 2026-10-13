import { promises as fs } from "fs";
import path from "path";
import crypto from "crypto";

const ROOT = path.join(process.cwd(), ".data");

function dirFor(bucket: string): string {
  return path.join(ROOT, bucket);
}

export async function ensureBucket(bucket: string): Promise<string> {
  const dir = dirFor(bucket);
  await fs.mkdir(dir, { recursive: true });
  return dir;
}

export function sanitizeFileName(name: string): string {
  const base = name.normalize("NFC").replace(/[\\/:*?"<>|\r\n]+/g, "_").trim();
  return base.slice(0, 120) || "file";
}

function toBuffer(data: Buffer | Uint8Array | ArrayBuffer): Buffer {
  if (Buffer.isBuffer(data)) return data;
  if (data instanceof ArrayBuffer) return Buffer.from(data);
  if (ArrayBuffer.isView(data)) return Buffer.from(data.buffer, data.byteOffset, data.byteLength);
  return Buffer.from(data as ArrayBuffer);
}

export function sha256(buf: Buffer | Uint8Array | ArrayBuffer): string {
  return crypto.createHash("sha256").update(toBuffer(buf)).digest("hex");
}

export function stamp(d = new Date()): string {
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

/** Save bytes under .data/<bucket>/<id>/<sanitized name>; returns relative path. */
export async function saveBytes(
  bucket: string,
  id: string,
  name: string,
  data: Uint8Array | ArrayBuffer | Buffer
): Promise<{ relPath: string; absPath: string }> {
  const dir = path.join(await ensureBucket(bucket), id);
  await fs.mkdir(dir, { recursive: true });
  const fname = sanitizeFileName(name);
  const absPath = path.join(dir, fname);
  await fs.writeFile(absPath, toBuffer(data));
  return { relPath: path.join(bucket, id, fname), absPath };
}

export async function readBytes(relPath: string): Promise<Buffer> {
  return fs.readFile(path.join(ROOT, relPath));
}

export function absOf(relPath: string): string {
  return path.join(ROOT, relPath);
}

export const MAX_FILE_BYTES = Number(process.env.XRAY_MAX_FILE_BYTES ?? 60 * 1024 * 1024);
