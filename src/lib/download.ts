"use client";
import { toast } from "@/components/toast";

/**
 * Fetch an output from the server download endpoint and save it via blob.
 * Throws a descriptive Error when the response is not 200 (caller shows it).
 */
export async function downloadOutput(outputId: string, filename?: string): Promise<void> {
  const response = await fetch(`/api/outputs/${outputId}/download`, { cache: "no-store" });
  if (!response.ok) {
    let message = `Download failed (${response.status})`;
    try {
      const json = await response.json();
      if (json?.message) message = `${json.errorCode ?? "DOWNLOAD_ERROR"}: ${json.message}`;
    } catch {
      /* not json */
    }
    toast(message, "error");
    throw new Error(message);
  }
  const blob = await response.blob();
  const name = filename ?? filenameFromDisposition(response.headers.get("content-disposition"));
  try {
    await validateDownloadBlob(
      blob,
      name,
      response.headers.get("content-type"),
      response.headers.get("content-length"),
      response.headers.get("content-encoding")
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    toast(message, "error");
    throw error;
  }
  saveBlob(blob, name);
}

/** Fail closed on empty/truncated exports and mislabeled XLSX responses. */
export async function validateDownloadBlob(
  blob: Blob,
  filename: string,
  contentType: string | null,
  contentLength: string | null,
  contentEncoding: string | null = null
): Promise<void> {
  if (blob.size === 0) throw new Error("EMPTY_DOWNLOAD: server returned an empty file");

  // Content-Length can describe compressed wire bytes while fetch exposes a
  // decompressed Blob. Only compare lengths when the response is unencoded.
  if (contentLength !== null && !contentEncoding) {
    const expected = Number(contentLength);
    if (!Number.isSafeInteger(expected) || expected < 0 || expected !== blob.size) {
      throw new Error(
        `DOWNLOAD_LENGTH_MISMATCH: expected ${contentLength} bytes but received ${blob.size}`
      );
    }
  }

  const ext = filename.split(".").pop()?.toLowerCase() ?? "";
  const expectedMime: Record<string, string> = {
    xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    xlsm: "application/vnd.ms-excel.sheet.macroenabled.12",
    xls: "application/vnd.ms-excel",
    csv: "text/csv",
    json: "application/json",
    ndjson: "application/x-ndjson",
    md: "text/markdown",
  };
  const actualMime = (contentType ?? "").split(";")[0].trim().toLowerCase();
  if (expectedMime[ext] && actualMime !== expectedMime[ext]) {
    throw new Error(
      `DOWNLOAD_MIME_MISMATCH: .${ext} expected ${expectedMime[ext]} but received ${actualMime || "no Content-Type"}`
    );
  }

  if (ext === "xlsx" || ext === "xlsm") {
    const signature = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
    if (
      signature.length < 4 ||
      signature[0] !== 0x50 ||
      signature[1] !== 0x4b ||
      signature[2] !== 0x03 ||
      signature[3] !== 0x04
    ) {
      throw new Error("INVALID_XLSX: downloaded file is not a valid ZIP-based Excel workbook");
    }
  }
}

/** Pure: pick the best filename from a Content-Disposition header. */
export function filenameFromDisposition(cd: string | null, fallback = "download"): string {
  if (!cd) return fallback;
  const star = /filename\*=UTF-8''([^;]+)/i.exec(cd);
  if (star) {
    try {
      return decodeURIComponent(star[1]);
    } catch {
      return star[1];
    }
  }
  const plain = /filename="([^"]+)"/i.exec(cd);
  if (plain) return plain[1];
  return fallback;
}

/** Save an in-memory blob (local/private mode exports). */
export function saveBlob(data: Blob | Uint8Array | string, filename: string, mime = "application/octet-stream") {
  const blob = data instanceof Blob ? data : new Blob([data as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  triggerDownload(url, filename);
}

function triggerDownload(url: string, filename: string) {
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
}
