# Enhancement API

All endpoints below operate on an already completed analysis. Enhanced outputs are separate files; uploaded originals are never overwritten.

## Profile workbook quality

```http
POST /api/analysis/{analysisId}/enhancement
Content-Type: application/json

{"action":"profile"}
```

Returns column type profiles, read-only data-quality findings, number-format proposals and review-first formula-repair proposals. Reports are capped at 500 items per category and include a `truncated` flag where applicable.

## Preview formatting and repairs

```json
{
  "action": "preview",
  "features": ["formatting", "numberFormats", "formulaRepairs"],
  "options": {
    "theme": "financial",
    "currencyCode": "JPY",
    "minConfidence": 0.9,
    "preserveExistingStyles": true,
    "preserveExistingColumnWidths": false
  }
}
```

Preview is read-only. Formula proposals remain suggestions; structural similarity does not establish business correctness.

## Apply enhancements

```json
{
  "action": "apply",
  "features": ["formatting", "numberFormats"],
  "options": {
    "theme": "report",
    "currencyCode": "JPY",
    "minConfidence": 0.9
  }
}
```

The API creates a job, stores a recovery snapshot, writes separate XLSX copies, runs offline export/reopen verification, records hashes and audit events, and returns downloadable output IDs. The response includes `jobId` and `outputs[].downloadUrl`.

Formula repair requires an explicit confirmation after reviewing the proposals:

```json
{
  "action": "apply",
  "features": ["formulaRepairs"],
  "confirmFormulaRepairs": true,
  "options": { "formulaMinConfidence": 0.95 }
}
```

This is a user opt-in, not a guarantee of semantic correctness. Verify formulas against business rules before using the result for financial, regulatory, or operational decisions.

## Verify current workbook models

```json
{"action":"verify"}
```

This runs local serializer/parser round-trip checks. It is not equivalent to opening and recalculating the workbook in Microsoft Excel.

## Undo an enhancement

```json
{"action":"undo","jobId":"<completed-enhancement-job-id>"}
```

Undo verifies the current normalized model matches the saved post-enhancement fingerprint, restores the snapshot, verifies the restored output, and creates separate restored files. It refuses to overwrite later changes. Recovery snapshots are stored under the application's configured private data directory; protect and back up that directory.

## Fail-closed compatibility

The reduced-model serializer blocks workbook rewrites when macro-enabled content, uncertain style metadata, or unsupported OOXML features are detected. This route does not claim full chart/pivot/connection/slicer/custom XML preservation. Use a dedicated native Excel workflow for macro-enabled recalculation; digital-signature workbooks are rejected by the recalculation adapter.

## Operational requirements

- The existing app requires PostgreSQL via `DATABASE_URL`.
- Files and recovery snapshots are stored under `XRAY_DATA_DIR` (default: `.data`). Persist this directory and PostgreSQL data together for durable recovery.
- The application currently follows the repository's existing API security model. Before exposing it to an untrusted network, add authentication/authorization, per-user ownership checks, rate limits and storage quotas to the API routes.
- Run `npm run typecheck`, `npm run lint`, `npm run test:unit`, `npm run test:integration`, and `npm run build` before release.
