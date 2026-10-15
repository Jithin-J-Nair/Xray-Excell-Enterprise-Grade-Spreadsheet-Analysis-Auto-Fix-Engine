# Enhancement validation matrix

This matrix is a release gate, not a claim that all checks have already passed.

| Area | Automated check in this branch | Additional release gate |
|---|---|---|
| Formatting | Deterministic theme, existing-style preservation and width bounds unit tests | Open exported workbooks in Excel; compare representative rendered sheets |
| Number formats | Proposal/apply thresholds and value-immutability tests | Validate date serials, locale, currency, percent scale and identifier columns against domain-specific fixtures |
| Formula repair | Nearby template consensus; no default mutation; explicit opt-in tests | Domain owner confirms formula semantics, units, edge cases and result deltas |
| Excel recalculation | CI installs LibreOffice Calc and runs a generated formula workbook through recalculation; checks cached result, formula text and round-trip verification. Excel COM has a separate manual smoke script. | Run `npm run verify:excel-com` on Windows with supported desktop Excel; compare cached results to Excel; exercise external links, UDFs and volatile functions; add real fixtures for charts, pivots, macros, validation and connections |
| OOXML preservation | Part names, worksheet/workbook XML markers, relationship types and content-type declarations are checked; synthetic regression tests cover charts, hyperlinks, validation, conditional formatting, VBA, signatures, pivot caches, query tables and embeddings | Add representative real workbook fixtures and verify each feature is preserved or blocked, including pivots/caches, external connections, embedded objects, digital signatures, and vendor extensions |
| Data quality | Mixed types, numeric-looking text, impossible dates, suspicious dates, negative quantities, duplicate rows and missing keys | Locale-specific and domain-specific datasets; false-positive review |
| Recovery | Snapshot integrity, optimistic conflict refusal, full model restoration, bounded retries, and DB integration test proving atomic claims and stale-token publication rejection | Add process-crash tests, periodic abandoned lease-directory cleanup, enhancement-operation fencing, multi-user edits, and retention/authorization |
| Batch | Ordering, per-file errors, safe relative paths, file limits and recursive folder processing tests | Large-volume load tests, cancellation, resumability, output packaging and disk-failure injection |
| Offline verification | Export/reopen and structural checks for sheets, formulas, cell values, explicit styles/formats and merge coordinates | OOXML package-part diff, formula result comparison, visual comparison and real Excel open/save tests |

## Execution commands

- `npm run typecheck`
- `npm run lint`
- `npm run test:unit`
- `npm run test:integration`
- `npm run build`

## Required engine setup

- **Microsoft Excel COM:** Windows host with desktop Excel installed/licensed; configure `POWERSHELL_PATH` only if PowerShell is not on PATH.
- **LibreOffice Calc:** install `soffice` and optionally configure `LIBREOFFICE_PATH`.
- Neither engine should run with access to untrusted macros or automatically update external links. The adapters operate on temporary copies.
- The analysis/export worker uses per-claim UUID fencing tokens for heartbeats, file-row inserts and final publication. Export files are written under token-specific directories. Enhancement API recalculation/undo operations are not yet integrated with this worker lease system.
- Current app access control is shared Basic Auth, not per-user authorization. Do not deploy as multi-tenant or expose to untrusted networks until ownership checks and a distributed rate limiter exist.
- `npm run verify:libreoffice` performs a real runtime smoke test and is included in CI after installing LibreOffice Calc. `npm run verify:excel-com` is a manual test for a Windows host with desktop Excel installed/licensed; Linux CI cannot prove Excel COM behavior.
- A successful parser round-trip is not a guarantee of visual equivalence or full OOXML feature preservation.
