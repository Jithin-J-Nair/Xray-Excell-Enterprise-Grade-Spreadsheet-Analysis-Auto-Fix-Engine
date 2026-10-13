import { describe, it } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { absOf } from "../src/lib/server/storage";

describe("storage path confinement", () => {
  it("resolves a valid storage key below .data", () => {
    const resolved = absOf(path.join("exports", "job-id", "book.xlsx"));
    assert.ok(resolved.endsWith(path.join(".data", "exports", "job-id", "book.xlsx")));
  });

  it("rejects traversal outside the storage root", () => {
    assert.throws(() => absOf("../outside.txt"), /INVALID_STORAGE_PATH/);
    assert.throws(() => absOf(path.resolve("outside.txt")), /INVALID_STORAGE_PATH/);
  });
});
