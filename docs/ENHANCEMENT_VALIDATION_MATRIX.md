# Enhancement validation matrix

This matrix is a release gate, not a claim that all checks have already passed.

| Area | Automated check in this branch | Additional release gate |
|---|---|---|
| Formatting | Deterministic theme, existing-style preservation and width bounds unit tests | Open exported workbooks in Excel; compare representative rendered sheets |
| Number formats | Proposal/apply thresholds and value-immutability tests | Validate date serials, locale, currency, percent scale and identifier columns against domain-specific fixtures |
| Formula repair | Nearby template consensus; no default mutation; explicit opt-in tests | Domain owner confirms formula semantics, units, edge cases and result deltas |
| Excel recalculation | LibreOffice adapter reopens output and checks formula locations; native Excel adapter checks structure | Run on Windows with supported Excel versions; compare cached results to Excel's own calculation; exercise external links, UDFs and volatile functions |
| OOXML preservation | Parser flags unsupported package parts; serializer fails closed | Fixtures with charts, pivots, slicers, macros, hyperlinks, validation, conditional formats, drawings, connections, controls, signatures and custom XML |
| Data quality | Mixed types, numeric-looking text, impossible dates, suspicious dates, negative quantities, duplicate rows and missing keys | Locale-specific and domain-specific datasets; false-positive review |
| Recovery | Snapshot integrity, optimistic conflict refusal and full model restoration tests | Persist snapshots durably, test process crashes, multi-user edits and retention/authorization |
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
- A successful parser round-trip is not a guarantee of visual equivalence or full OOXML feature preservation.
