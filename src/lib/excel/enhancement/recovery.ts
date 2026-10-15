import type { WorkbookModel } from "../types";

export interface RecoverySnapshot {
  schemaVersion: 1;
  createdAt: string;
  workbookId: string;
  originalFingerprint: string;
  expectedCurrentFingerprint?: string;
  original: WorkbookModel;
}
const clone = <T,>(value: T): T => JSON.parse(JSON.stringify(value)) as T;
/** Stable serialization is sufficient for optimistic concurrency checks; not a cryptographic signature. */
export function fingerprintWorkbook(model: WorkbookModel): string {
  const input = JSON.stringify(model);
  let h1 = 0x811c9dc5, h2 = 0x9e3779b9;
  for (let i = 0; i < input.length; i++) {
    const code = input.charCodeAt(i);
    h1 = Math.imul(h1 ^ code, 0x01000193);
    h2 = Math.imul(h2 ^ code, 0x85ebca6b);
  }
  return [h1 >>> 0, h2 >>> 0, input.length].map(n => n.toString(16).padStart(8, "0")).join("-");
}
/** Create before applying a repair; persist the returned JSON in durable storage for cross-session recovery. */
export function createRecoverySnapshot(model: WorkbookModel, createdAt = new Date().toISOString()): RecoverySnapshot {
  if (model.truncated) throw new Error("MODEL_TRUNCATED: cannot snapshot a partial workbook.");
  const original = clone(model);
  return { schemaVersion: 1, createdAt, workbookId: model.fileId, originalFingerprint: fingerprintWorkbook(original), original };
}
/** Seal the snapshot after the successful transformation so undo rejects later unrelated edits. */
export function sealRecoverySnapshot(snapshot: RecoverySnapshot, transformed: WorkbookModel): RecoverySnapshot {
  if (snapshot.workbookId !== transformed.fileId) throw new Error("RECOVERY_WORKBOOK_MISMATCH");
  return { ...clone(snapshot), expectedCurrentFingerprint: fingerprintWorkbook(transformed) };
}
/** Restore the complete original model only when the current state matches the recorded post-repair state. */
export function undoWorkbook(snapshot: RecoverySnapshot, current: WorkbookModel, force = false): WorkbookModel {
  if (snapshot.schemaVersion !== 1 || snapshot.workbookId !== current.fileId) throw new Error("RECOVERY_SNAPSHOT_INVALID");
  if (fingerprintWorkbook(snapshot.original) !== snapshot.originalFingerprint) throw new Error("RECOVERY_SNAPSHOT_CORRUPT");
  if (!force && (!snapshot.expectedCurrentFingerprint || fingerprintWorkbook(current) !== snapshot.expectedCurrentFingerprint)) {
    throw new Error("RECOVERY_CONFLICT: current workbook differs from the recorded post-repair state; refusing to overwrite newer edits.");
  }
  return clone(snapshot.original);
}
export function serializeRecoverySnapshot(snapshot: RecoverySnapshot): string { return JSON.stringify(snapshot); }
export function parseRecoverySnapshot(json: string): RecoverySnapshot {
  const value = JSON.parse(json) as RecoverySnapshot;
  if (value?.schemaVersion !== 1 || typeof value.workbookId !== "string" || !value.original || typeof value.originalFingerprint !== "string") {
    throw new Error("RECOVERY_SNAPSHOT_INVALID");
  }
  if (fingerprintWorkbook(value.original) !== value.originalFingerprint) throw new Error("RECOVERY_SNAPSHOT_CORRUPT");
  return value;
}
