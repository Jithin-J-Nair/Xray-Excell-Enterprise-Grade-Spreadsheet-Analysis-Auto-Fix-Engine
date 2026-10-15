# Enhancement engine status

This document describes the enhancement branch and does not claim complete Excel fidelity.

## Implemented
- Deterministic report/financial style themes for cells in the current workbook model.
- Existing style preservation by default, optional replacement, bounded content-based column widths, structured change records and read-only style consistency inspection.
- Read-only data-quality profiling for mixed types, numeric-looking text, suspicious date years, negative quantity-like values, possible duplicate rows and configured missing keys. Findings are review-only and never mutate cell values.

## Not yet implemented / constrained
- Authoritative Microsoft Excel recalculation requires a separate Windows worker with desktop Excel/COM and appropriate licensing.
- No headless formula evaluator is claimed to be Excel-equivalent.
- Full OOXML package preservation for charts, pivots, connections, embedded objects, VBA and digital signatures is not guaranteed by the reduced model serializer; keep failing closed when unsupported features are detected.
- Batch folder processing, durable full-file rollback and COM/LibreOffice integration remain tracked issues.
- Frozen panes and native Excel tables are not introduced by this initial model-only formatter.
- Tests have not been executed in the connected repository environment.

## Safety policy
Never mutate source files in place, never auto-apply ambiguous data-quality findings, and never silently remove macros or signatures. All changes stay on feat/safe-enhancement-engine until reviewed and merged by the repository owner.