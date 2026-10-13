import { pgTable, uuid, text, integer, boolean, timestamp, jsonb, index } from "drizzle-orm/pg-core";

export const uploads = pgTable("uploads", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  fileCount: integer("file_count").notNull().default(0),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const files = pgTable(
  "files",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id").references(() => uploads.id),
    jobId: uuid("job_id"),
    analysisId: uuid("analysis_id"),
    kind: text("kind").notNull(), // original | export | patch | reverted
    name: text("name").notNull(),
    size: integer("size").notNull().default(0),
    mime: text("mime").notNull().default("application/octet-stream"),
    path: text("path").notNull(),
    sha256: text("sha256"),
    meta: jsonb("meta"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("files_upload_idx").on(t.uploadId), index("files_job_idx").on(t.jobId)]
);

export const analyses = pgTable(
  "analyses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    uploadId: uuid("upload_id").references(() => uploads.id),
    name: text("name").notNull(),
    mode: text("mode").notNull().default("server"), // server | local
    options: jsonb("options").notNull().default({}),
    status: text("status").notNull().default("queued"), // queued | processing | completed | failed
    progress: integer("progress").notNull().default(0),
    statusText: text("status_text").notNull().default(""),
    log: jsonb("log").notNull().default([]),
    result: jsonb("result"),
    error: text("error"),
    reverted: boolean("reverted").notNull().default(false),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("analyses_created_idx").on(t.createdAt)]
);

export const previews = pgTable(
  "previews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id")
      .notNull()
      .references(() => analyses.id),
    tools: jsonb("tools").notNull().default([]),
    options: jsonb("options").notNull().default({}),
    summary: jsonb("summary").notNull().default({}),
    diffs: jsonb("diffs").notNull().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("previews_analysis_idx").on(t.analysisId)]
);

export const jobs = pgTable(
  "jobs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id").references(() => analyses.id),
    previewId: uuid("preview_id"),
    kind: text("kind").notNull(), // analysis | apply
    status: text("status").notNull().default("queued"), // queued | running | completed | failed
    progress: integer("progress").notNull().default(0),
    formats: jsonb("formats").notNull().default([]),
    outputs: jsonb("outputs").notNull().default([]), // [{format,fileId,name,size}]
    patchFileId: uuid("patch_file_id"),
    summary: jsonb("summary").notNull().default({}),
    error: text("error"),
    reverted: boolean("reverted").notNull().default(false),
    undoFileId: uuid("undo_file_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (t) => [index("jobs_analysis_idx").on(t.analysisId)]
);

export const auditLogs = pgTable(
  "audit_logs",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    analysisId: uuid("analysis_id"),
    action: text("action").notNull(),
    detail: jsonb("detail").notNull().default({}),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("audit_analysis_idx").on(t.analysisId)]
);

export const customRules = pgTable("custom_rules", {
  id: uuid("id").primaryKey().defaultRandom(),
  name: text("name").notNull(),
  groupName: text("group_name").notNull().default("custom"),
  description: text("description").notNull().default(""),
  definition: jsonb("definition").notNull().default({}),
  enabled: boolean("enabled").notNull().default(true),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Analysis = typeof analyses.$inferSelect;
export type Preview = typeof previews.$inferSelect;
export type Job = typeof jobs.$inferSelect;
export type FileRow = typeof files.$inferSelect;
