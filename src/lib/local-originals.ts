/**
 * Private-mode original file store (IndexedDB).
 * Lets Undo re-download the exact bytes the user scanned, without uploading them.
 */

const DB_NAME = "xray-excel-local";
const DB_VERSION = 1;
const STORE = "originals";

export interface LocalOriginalFile {
  name: string;
  mime: string;
  bytes: ArrayBuffer;
}

export interface LocalOriginalBundle {
  analysisId: string;
  createdAt: number;
  files: LocalOriginalFile[];
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        db.createObjectStore(STORE, { keyPath: "analysisId" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error("INDEXEDDB_OPEN_FAILED"));
  });
}

export async function saveLocalOriginals(analysisId: string, files: { name: string; mime?: string; bytes: Uint8Array }[]): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const bundle: LocalOriginalBundle = {
    analysisId,
    createdAt: Date.now(),
    files: files.map((f) => ({
      name: f.name,
      mime: f.mime ?? "application/octet-stream",
      bytes: f.bytes.buffer.slice(f.bytes.byteOffset, f.bytes.byteOffset + f.bytes.byteLength) as ArrayBuffer,
    })),
  };
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(bundle);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("INDEXEDDB_PUT_FAILED"));
  });
  db.close();
}

export async function loadLocalOriginals(analysisId: string): Promise<LocalOriginalBundle | null> {
  if (typeof indexedDB === "undefined") return null;
  const db = await openDb();
  const bundle = await new Promise<LocalOriginalBundle | null>((resolve, reject) => {
    const tx = db.transaction(STORE, "readonly");
    const req = tx.objectStore(STORE).get(analysisId);
    req.onsuccess = () => resolve((req.result as LocalOriginalBundle | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error("INDEXEDDB_GET_FAILED"));
  });
  db.close();
  return bundle;
}

export async function deleteLocalOriginals(analysisId: string): Promise<void> {
  if (typeof indexedDB === "undefined") return;
  const db = await openDb();
  await new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).delete(analysisId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error("INDEXEDDB_DELETE_FAILED"));
  });
  db.close();
}
