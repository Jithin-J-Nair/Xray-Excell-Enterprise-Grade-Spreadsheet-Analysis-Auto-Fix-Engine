# X-RAY://EXCEL v2

**Enterprise spreadsheet auditor, refactorer & data cleaner** — static analysis, deterministic repair, dependency graphs, risk scoring, reversible patches, and audit-ready exports for `.xlsx .xlsm .xlsb .xls .csv .tsv .json .ndjson`.

エンタープライズ向けスプレッドシット監査・リファクタ・データクリーナー。静的解析、決定論的修復、依存グラフ、リスクスコア、可逆パッチ、監査対応エクスポート。

---

## 1. Architecture

```
┌────────────────────────── Browser (Next.js 16 · React 19 · Tailwind v4) ─────┐
│ Dashboard · New Analysis · Analysis (Overview / Graph / Risks / Sheets /      │
│ Workbench / Export) · Rules & Settings · EN/JP i18n                           │
│ Local Mode: parseFile() + analyzeAll() run 100% in-browser (same TS engine)   │
└──────────────▲───────────────────────────────────────────────────────────────┘
               │ JSON / multipart / chunked streams
┌──────────────┴───────────── API (Next.js route handlers, Node runtime) ──────┐
│ POST /api/upload                 POST /api/analysis/:id/preview              │
│ POST /api/analysis               POST /api/analysis/:id/apply                │
│ POST /api/analysis/import        GET  /api/jobs/:id                          │
│ GET  /api/analysis/:id(/status)  GET  /api/download/:fileId  (stream+RFC5987)│
│ POST /api/undo/:applyId          GET/POST /api/rules                         │
│ POST /api/samples                GET  /api/dashboard · GET /api/health       │
├───────────────────────────────────────────────────────────────────────────────┤
│ Isomorphic Excel Engine (src/lib/excel)                                       │
│  parse.ts      → bytes → WorkbookModel (SheetJS; Shift_JIS→UTF-8 detection)   │
│  formula.ts    → tokenizer, ref extraction, R1C1 abstract/instantiate         │
│  analyze.ts    → 18 finding types, dependency graph, Tarjan SCC cycles        │
│  transform.ts  → 12 deterministic rules T001–T013 with cell-level diffs       │
│  serialize.ts  → XLSX (formulas/merges/names preserved) · CSV+ BOM · JSON ·   │
│                  NDJSON · localized MD report                                 │
│  samples.ts    → generated "monster" + JP messy workbooks (QA/demo)           │
├───────────────────────────────────────────────────────────────────────────────┤
│ PostgreSQL (Drizzle): uploads · files · analyses · previews · jobs ·          │
│ audit_logs · custom_rules        FS object store: .data/{uploads,exports}     │
└───────────────────────────────────────────────────────────────────────────────┘
```

**Determinism guarantee:** identical `(model, tools, options)` always produce identical diffs and exports. Originals are immutable; every apply writes to a copy, stores a forward+reverse patch, and can be reverted byte-identically via undo.

## 2. API contracts

| Endpoint | Body → Response |
|---|---|
| `POST /api/upload` | multipart `files[]` → `{ uploadId, files:[{id,name,size}], status }` |
| `POST /api/analysis` | `{ uploadId, options:{resolveCrossFile, language} }` → `{ analysisId, status }` |
| `POST /api/analysis/import` | local mode: `{ name, language, result }` → `{ analysisId }` |
| `GET /api/analysis/:id/status` | → `{ status, progress, statusText, log[], metrics }` |
| `GET /api/analysis/:id` | → full analysis + source files + jobs + audit trail |
| `POST /api/analysis/:id/preview` | `{ tools:[T0xx], options }` → `{ previewId, diffs[], summary }` |
| `POST /api/analysis/:id/apply` | `{ previewId, exportFormats:["xlsx","csv","json","ndjson","md"] }` → `{ jobId }` · local: `{ localRecord:true,… }` |
| `GET /api/jobs/:id` | → `{ status, progress, outputs:[{format,fileId,name,size}], summary }` |
| `GET /api/outputs/:outputId/download` | **binary stream** of a generated export: exact MIME, `Content-Disposition: attachment; filename=…; filename*=UTF-8''…`, `Cache-Control: no-store` |
| `GET /api/download/:fileId` | chunked stream, correct MIME, `filename*=UTF-8''…`, `X-Content-SHA256` |
| `POST /api/undo/:applyId` | → `{ status:"reverted", fileId }` (restored original) |
| `GET/POST /api/rules` | rule registry / custom rule registration |
| `POST /api/samples` | `{ kind:"monster"\|"jp" }` → generates a messy demo workbook |

Structured errors: `{ errorCode, message, retryable, details? }`.

## 3. Deterministic rule registry

| ID | Group | Rule | Safety |
|---|---|---|---|
| T001 | organize | Extract repeated hard-coded literals into a **Parameters** sheet + named ranges | review |
| T002 | organize | Align deviating column formulas to the majority R1C1 pattern | safe |
| T003 | mitigate | Snapshot external-workbook links to values + `SourceData` relink log | review |
| T004 | mitigate | Freeze volatile functions (NOW/TODAY/RAND/OFFSET/INDIRECT…) to cached values | review |
| T005 | organize | Unmerge ranges, fill with anchor values | safe |
| T006 | organize | Remove broken (`#REF!`) / duplicate named ranges | safe |
| T007 | clean | Trim whitespace, NBSP / ideographic-space → space | safe |
| T008 | clean | Remove exact duplicate rows | review |
| T009 | clean | Full-width → half-width, NFC normalization | safe |
| T010 | clean | Parse date text (`YYYY/MM/DD`, `YYYY-MM-DD`, `YYYY年M月D日`) into date cells | safe |
| T011 | mitigate | Wrap error-producing formulas in `IFERROR`; blank error literals | safe |
| T013 | clean | Coerce comma-grouped numeric text to numbers | safe |

**Auto-Fix** = `T002 T003 T005 T007 T009 T011`. Every diff carries `{ sheet, cell, before, after, ruleId, reason, confidence, riskDelta }`.

## 4. Detected finding types (18)

`CIRCULAR_REF` (Tarjan SCC) · `VOLATILE_FUNCTION` · `EXTERNAL_LINK` · `HARDCODED_NUMBER` · `MERGED_CELLS` · `HIDDEN_SHEET` (incl. referenced hidden sheets) · `INCONSISTENT_FORMULA` · `BROKEN_NAMED_RANGE` · `ERROR_CELL` · `DUPLICATE_ROWS` · `MIXED_TYPES` · `WHITESPACE` · `UNICODE_FULLWIDTH` · `DATE_AS_TEXT` · `NUMBER_AS_TEXT` · `ENCODING` (mojibake/Shift_JIS) · `EMPTY_SHEET` · `LONG_FORMULA`.

## 5. Demo script (end-to-end, ~3 min)

1. `npm run dev` (or the platform preview) → open **Dashboard**.
2. Click **Generate monster workbook** — 22 sheets with circular refs, an unresolved `[Budget2023.xlsx]` link, volatile functions, duplicates, hidden/very-hidden sheets, broken named ranges.
3. Watch the **scan terminal** stream engine logs until analysis completes.
4. **Overview**: health donut, risk distribution, sheet inventory. **Dependency Graph**: pan/zoom, click nodes, note the pink circular path. **Risks**: filter by severity; each finding shows its auto-fix rule id. **Sheets & Cells**: toggle formula view; risky cells glow red.
5. **Tools & Preview**: leave Auto-Fix defaults → **Run preview** → inspect cell-level before→after diffs and the risk-score delta.
6. Pick formats (`xlsx` + `csv` + `md`) → **Apply & generate exports** → download the fixed workbook (formulas preserved), CSV (UTF-8 BOM), and the audit report.
7. **Export & Audit**: download the reverse patch, then **Undo** — a byte-identical restored original is produced, and the job is marked reverted.
8. 日本語デモ: **日本語メシーブック** generates 全角文字・日付文字列・カンマ数値・結合セル・非表示シート — same flow works fully in JP (language toggle in header).

## 6. Run & develop

```bash
npm install
npx drizzle-kit push   # create tables (PostgreSQL via DATABASE_URL)
npm run build && npm start
```

Validation: `npx next typegen` · `tsc --noEmit` · `npm run build` — all green.

## Tests

```bash
node --import tsx --test tests/*.test.ts   # 38 tests, all engine-pure + one live integration
```

- `tests/formula.test.ts` — tokenizer, externals, function-vs-ref disambiguation, R1C1 relocation, literal replacement
- `tests/transform.test.ts` — all 12 deterministic rules produce correct diffs/mutations; input immutability; determinism
- `tests/graph-state.test.ts` — toggle state machine (`{id, enabled, available, defaultOn}`, preview payload = enabled+available only), graph filtering (sheet/severity/type/circular/external, 1-hop widening, 300-node cap), dagre layout (per-sheet clusters, routed edges, LR ranks)
- `tests/download.test.ts` — live integration for `GET /api/outputs/:outputId/download` (exact headers, byte-identical stream, structured 404) + RFC 5987 filename parsing used by the browser blob download path

Frontend downloads (server + local mode) go through `src/lib/download.ts`: `fetch → blob → URL.createObjectURL → a.click → revoke`, with loading state and error toasts.

## 7. Roadmap

- **v2** — parameter extraction upgrades, circular-ref resolution assistant, external-link relink map UI, schema/parquet export, rule engine v2 (apply custom JSON rules).
- **v3** — LLM-assisted naming & documentation (deterministic output), git-like workbook versioning, collaborative review, Google Sheets / OneDrive connectors, scheduled scans.
- **v4** — generated unit tests for critical formulas, sandboxed iteration engine, auto-refactor to Python/SQL, data lineage & impact analysis.
