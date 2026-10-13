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
  saveBlob(blob, name);
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
