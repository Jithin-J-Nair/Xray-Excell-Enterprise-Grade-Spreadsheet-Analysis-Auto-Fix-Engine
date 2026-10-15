export interface BatchInput { name: string; bytes: Uint8Array }
export interface BatchSuccess<T> { name: string; ok: true; value: T; inputBytes: number }
export interface BatchFailure { name: string; ok: false; error: string; inputBytes: number }
export type BatchResult<T> = BatchSuccess<T> | BatchFailure;
export interface BatchOptions { concurrency?: number; maxFiles?: number; maxBytesPerFile?: number; maxTotalBytes?: number }
export type BatchProcessor<T> = (file: Readonly<BatchInput>) => Promise<T>;
/**
 * Bounded batch orchestration for already-selected files. It never writes source files,
 * never mutates input bytes, and reports per-file errors rather than hiding partial failure.
 * Filesystem selection/output and durable job queues belong to the server/UI integration layer.
 */
export async function processWorkbookBatch<T>(files: readonly BatchInput[], processor: BatchProcessor<T>, options: BatchOptions = {}): Promise<BatchResult<T>[]> {
  const concurrency = options.concurrency ?? 2, maxFiles = options.maxFiles ?? 50;
  const maxBytes = options.maxBytesPerFile ?? 50 * 1024 * 1024, maxTotal = options.maxTotalBytes ?? 200 * 1024 * 1024;
  if (!Number.isInteger(concurrency) || concurrency < 1 || concurrency > 8) throw new Error("INVALID_BATCH_CONCURRENCY: expected an integer from 1 to 8.");
  if (files.length > maxFiles) throw new Error("BATCH_FILE_LIMIT_EXCEEDED");
  const names = new Set<string>();
  let total = 0;
  for (const file of files) {
    const safeName = file.name.replace(/\\/g, "/");
    const parts = safeName.split("/");
    if (!safeName || safeName.startsWith("/") || /^[A-Za-z]:/.test(safeName) ||
        parts.some(part => !part || part === "." || part === ".." || part.includes("\\0"))) {
      throw new Error("UNSAFE_BATCH_FILENAME");
    }
    if (names.has(safeName.toLocaleLowerCase())) throw new Error("DUPLICATE_BATCH_FILENAME: " + safeName);
    names.add(safeName.toLocaleLowerCase());
    if (!(file.bytes instanceof Uint8Array) || file.bytes.byteLength > maxBytes) throw new Error("BATCH_FILE_SIZE_LIMIT: " + safeName);
    total += file.bytes.byteLength;
    if (total > maxTotal) throw new Error("BATCH_TOTAL_SIZE_LIMIT_EXCEEDED");
  }
  const results: BatchResult<T>[] = new Array(files.length);
  let cursor = 0;
  async function worker(): Promise<void> {
    while (true) {
      const index = cursor++;
      if (index >= files.length) return;
      const file = files[index];
      try {
        // Copy bytes so a processor cannot mutate the caller's original buffer.
        const value = await processor({ name: file.name, bytes: file.bytes.slice() });
        results[index] = { name: file.name, ok: true, value, inputBytes: file.bytes.byteLength };
      } catch (error) {
        results[index] = { name: file.name, ok: false, error: error instanceof Error ? error.message : String(error), inputBytes: file.bytes.byteLength };
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, files.length) }, () => worker()));
  return results;
}
