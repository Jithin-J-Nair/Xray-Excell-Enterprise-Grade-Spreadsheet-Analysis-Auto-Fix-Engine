# X-RAY://EXCEL

**Language / 言語:** [English](README.md) · [日本語](README.ja.md)

---

**Excel tangle finder for finance and operations teams.**  
Scan messy workbooks for structural problems. Preview every proposed fix. Keep only what you accept. Download a cleaned copy — the original file is never overwritten.

> Not an Excel replacement. Not a financial auditor. Not a full calculation engine in the main workbench.

---

## What it does

| Capability | What you get |
|---|---|
| **Structural scan** | 18 finding types: circular refs, external links, volatile functions, full-width text, dates/numbers as text, merges, duplicates, and more |
| **Japan hygiene pack** | One click in Fix & preview enables spaces, full-width, date-as-text, and number-as-text tools (T007 / T009 / T010 / T013) when findings exist |
| **Cross-file formula map** | Upload linked workbooks together; filter the dependency graph to cross-file / external edges only |
| **Preview → keep → download** | Cell-level before/after diffs; tick changes to keep; apply writes a copy only |
| **Role check packs** | Overview filters for Accounting (経理), Budget (予算), and Billing (請求) — structural views, not finance sign-off |
| **Audit & change pack** | Activity log plus reverse change log (patch JSON) on every server apply; undo restores the upload |
| **Extra polish (optional)** | Formatting / number-format proposals; LibreOffice or Windows Excel COM recalculation on a **copy**, with a formula **value-diff** table |

### Honest limits

- Does **not** prove financial or business correctness  
- Does **not** run Excel’s full calculation engine inside the main Fix & preview flow  
- Does **not** repair VBA, Power Query, pivots, charts, or custom uploaded rules  
- Recalculation needs LibreOffice (`soffice`) or Windows desktop Excel; LibreOffice ≠ Excel parity  

---

## Quick start

```bash
npm install
npx drizzle-kit push    # PostgreSQL via DATABASE_URL
npm run dev             # http://localhost:3000
```

1. Open the app → toggle **EN / JP** in the header (persists in the browser).  
2. **Start a workbook scan** — or generate the monster / Japanese sample.  
3. Review **Overview** (health + role packs), **Formula map**, **Issues**, then **Fix & preview**.  
4. Use **Japan hygiene** or **Quick clean**, run **Preview changes**, keep or skip rows, **Apply & download**.  
5. On server scans, optional **Extra polish → Recalculate formulas** shows which cached formula values moved on the copy.

Private mode keeps bytes on the device. Server mode supports larger batches and durable undo.

---

## Architecture

```
Browser (Next.js · React · Tailwind)
  Dashboard · Scan · Analysis tabs · EN/JP i18n
  Local mode: same TypeScript engine in-browser
        │
API (route handlers)
  upload · analysis · preview · apply · jobs · download · undo · samples
        │
Isomorphic engine (src/lib/excel)
  parse → analyze (18 risks + graph) → transform (T001–T013) → serialize
        │
PostgreSQL (Drizzle) + filesystem object store (.data/)
```

**Determinism:** the same model, tools, and options always produce the same diffs and exports. Applies never mutate the upload; undo restores a byte-identical original on the server (private mode re-downloads originals kept in the browser when available).

---

## Fix tools (T001–T013)

| ID | Group | Action | Safety |
|---|---|---|---|
| T001 | organize | Move repeated literals to a Parameters sheet | review |
| T002 | organize | Align column formulas to the majority pattern | review |
| T003 | mitigate | Replace live external links with saved values | review |
| T004 | mitigate | Freeze volatile functions to cached values | review |
| T005 | organize | Unmerge cells | review |
| T006 | organize | Remove broken / duplicate named ranges | usually safe |
| T007 | clean | Trim whitespace (incl. invisible spaces) | usually safe · Quick clean · Japan hygiene |
| T008 | clean | Remove exact duplicate rows | review |
| T009 | clean | Full-width → half-width (NFC) | usually safe · Quick clean · Japan hygiene |
| T010 | clean | Date text → real date cells | usually safe · Japan hygiene |
| T011 | mitigate | Wrap errors in IFERROR (masks, does not fix logic) | review |
| T012 | mitigate | Break circular chains by freezing one cell per cycle | review |
| T013 | clean | Numeric text → real numbers | usually safe · Japan hygiene |

**Quick clean** = T007 + T009 only.  
**Japan hygiene** = T007 + T009 + T010 + T013 when those tools have findings.

---

## Finding types (18)

`CIRCULAR_REF` · `VOLATILE_FUNCTION` · `EXTERNAL_LINK` · `HARDCODED_NUMBER` · `MERGED_CELLS` · `HIDDEN_SHEET` · `INCONSISTENT_FORMULA` · `BROKEN_NAMED_RANGE` · `ERROR_CELL` · `DUPLICATE_ROWS` · `MIXED_TYPES` · `WHITESPACE` · `UNICODE_FULLWIDTH` · `DATE_AS_TEXT` · `NUMBER_AS_TEXT` · `ENCODING` · `EMPTY_SHEET` · `LONG_FORMULA`

---

## API surface (summary)

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/upload` | Multipart upload |
| `POST` | `/api/analysis` | Start server scan |
| `POST` | `/api/analysis/import` | Persist a local-mode result |
| `GET` | `/api/analysis/:id` | Full result + jobs + audit |
| `POST` | `/api/analysis/:id/preview` | Tool preview diffs |
| `POST` | `/api/analysis/:id/apply` | Apply kept changes → export job |
| `POST` | `/api/analysis/:id/enhancement` | Extra polish / recalculate |
| `GET` | `/api/jobs/:id` | Job status + outputs |
| `GET` | `/api/outputs/:id/download` | Binary download |
| `POST` | `/api/undo/:applyId` | Restore original |
| `POST` | `/api/samples` | `monster` or `jp` demo workbook |

Errors: `{ errorCode, message, retryable, details? }`.

---

## Develop & test

```bash
npm run typecheck
npm run lint
npm run test:unit
npm run test:integration   # needs PostgreSQL
npm run build
npm start
npm run worker             # durable job poller for production
```

Key unit coverage: formula parsing, transforms (incl. keep/skip), graph filters (circular / external / cross-file), Japan hygiene selection, role packs, value diffs (`tests/japan-top5.test.ts`).

---

## Production notes

- Set `XRAY_BASIC_AUTH_USER` and `XRAY_BASIC_AUTH_PASSWORD` (fail-closed 503 if missing).  
- Persist `XRAY_DATA_DIR`; tune retention / job heartbeats via `XRAY_*` env vars.  
- Use HTTPS; Basic Auth is a shared gate, not multi-user IAM.  
- XLSX export refuses unsupported OOXML features rather than silently dropping them.  

Corpus / release evidence: `docs/RELEASE_BENCHMARK.md`.

---

## License

MIT — see repository license file.

**Language / 言語:** [English](README.md) · [日本語](README.ja.md)
