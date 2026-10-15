import { lstat, readdir, readFile } from "node:fs/promises";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";
import type { BatchInput, BatchOptions, BatchProcessor, BatchResult } from "./batch";
import { processWorkbookBatch } from "./batch";

export interface DirectoryBatchOptions extends BatchOptions { maxDepth?: number; extensions?: string[] }
const DEFAULT_EXTENSIONS = [".xlsx", ".xlsm", ".xlsb", ".xls", ".csv", ".tsv", ".txt", ".json", ".ndjson"];
/**
 * Recursively collects regular spreadsheet files under a selected local directory without following
 * symlinks, validates total/file/depth budgets before reading, then delegates to bounded processing.
 * It never writes to the source tree; processor results must be written to a separate destination.
 * Node/server-only API. Do not import from a client component.
 */
export async function processWorkbookDirectory<T>(
  rootDirectory: string,
  processor: BatchProcessor<T>,
  options: DirectoryBatchOptions = {}
): Promise<BatchResult<T>[]> {
  const root = resolve(rootDirectory), maxDepth = options.maxDepth ?? 8;
  const maxFiles = options.maxFiles ?? 50, maxBytes = options.maxBytesPerFile ?? 50 * 1024 * 1024;
  const maxTotal = options.maxTotalBytes ?? 200 * 1024 * 1024;
  if (!Number.isInteger(maxDepth) || maxDepth < 0 || maxDepth > 20) throw new Error("INVALID_DIRECTORY_DEPTH");
  const allowed = new Set((options.extensions ?? DEFAULT_EXTENSIONS).map(e => e.toLowerCase().startsWith(".") ? e.toLowerCase() : "." + e.toLowerCase()));
  const found: Array<{ path: string; name: string; size: number }> = [];
  async function walk(directory: string, depth: number): Promise<void> {
    const entries = await readdir(directory, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const fullPath = resolve(directory, entry.name);
      const rel = relative(root, fullPath);
      if (rel === ".." || rel.startsWith(".." + sep) || isAbsolute(rel)) throw new Error("DIRECTORY_PATH_ESCAPE");
      if (entry.isDirectory()) {
        if (depth >= maxDepth) throw new Error("BATCH_DIRECTORY_DEPTH_LIMIT: " + rel);
        await walk(fullPath, depth + 1);
      } else if (entry.isFile() && allowed.has(extname(entry.name).toLowerCase())) {
        const info = await lstat(fullPath);
        if (!info.isFile()) continue;
        if (info.size > maxBytes) throw new Error("BATCH_FILE_SIZE_LIMIT: " + rel);
        found.push({ path: fullPath, name: rel.split(sep).join("/"), size: info.size });
        if (found.length > maxFiles) throw new Error("BATCH_FILE_LIMIT_EXCEEDED");
      }
    }
  }
  const rootInfo = await lstat(root);
  if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("BATCH_ROOT_NOT_DIRECTORY");
  await walk(root, 0);
  const total = found.reduce((sum, file) => sum + file.size, 0);
  if (total > maxTotal) throw new Error("BATCH_TOTAL_SIZE_LIMIT_EXCEEDED");
  const files: BatchInput[] = [];
  for (const file of found.sort((a,b) => a.name.localeCompare(b.name))) {
    files.push({ name: file.name, bytes: new Uint8Array(await readFile(file.path)) });
  }
  return processWorkbookBatch(files, processor, options);
}
