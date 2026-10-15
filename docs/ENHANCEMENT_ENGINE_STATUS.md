# Enhancement engine status

This document distinguishes implemented library capabilities from application integration and verified runtime behavior. Presence of code does not imply production validation.

## Implemented on `feat/safe-enhancement-engine`

- Deterministic report/financial themes; header fill/font/alignment/border; readable body fonts; data-type alignment; subtle row separators; optional banding; bounded content-based widths; structured change records; deep style merging that fills missing properties without replacing existing explicit style leaves.
- Read-only number-format proposals for dates, currencies, percentages, integers and decimals. Explicit repair is opt-in, confidence-thresholded, and changes number-format metadata only; it never coerces cell values. Currency and percentage conventions remain ambiguous without caller-provided business configuration.
- Read-only data-quality profiling for mixed types, numeric-looking text, suspicious date years, impossible calendar dates, negative quantity-like values, possible duplicate rows and configured missing keys. Findings are never automatically applied.
- Review-first structural formula-repair proposals based on nearby formula-template consensus. The library does **not** infer business meaning, units, accounting rules, or intended formulas. Applying a proposal requires explicit opt-in and a confidence threshold.
- Guarded recovery snapshots that capture the complete normalized model, can be serialized for persistence, and reject undo when the current model differs from the recorded post-repair state. Durable database retention, authorization and retention policy still require application integration.
- Bounded in-memory batch orchestration with file-count/size/concurrency limits, safe relative paths, duplicate-name rejection, input-buffer isolation, stable result ordering and per-file failures. A server-only directory adapter recursively processes supported workbook files under a selected root, checks depth/file/byte budgets before reading, skips symlinks and never writes to the source tree. The analysis upload UI supports selecting a folder and processing its workbook files as a bounded batch of up to 12 files; recursive server-filesystem traversal remains a server-only library API.
- Offline XLSX export/reopen checks that compare sheets, formulas, cell signatures, merges and formula counts. This validates the reduced-model serializer path only; it does not prove visual parity or preservation of unsupported OOXML parts.
- LibreOffice Calc adapter for isolated-copy recalculation when `soffice` is installed. LibreOffice is not Microsoft Excel and may calculate proprietary functions differently.
- Native Microsoft Excel COM adapter for Windows hosts with installed/licensed desktop Excel. It opens a disposable copy with macros disabled and external-link updates suppressed, forces a full dependency rebuild, saves in the original XLSX/XLSM format, and checks worksheet/formula structure and feature markers. It does not guarantee identical outcomes for every add-in, external data source, macro-driven workbook, or third-party Excel extension.
- OOXML inspection now detects digital-signature parts. Signed workbooks are blocked from recalculation because saving changes can invalidate signatures.
- Regression tests were added for formatting, data-quality, number-format proposals, formula proposals, recovery, batch orchestration and local round-trip verification. **The tests have not yet been executed in this connected editing environment.**

## Not yet production-complete

- Business-aware formula repair still needs explicit domain rules, named input semantics, unit/currency checks, formula result comparison, and human approval. Structural similarity is not proof of correctness.
- Full OOXML preservation across charts, pivot tables/caches, macros, hyperlinks, validation, conditional formatting, drawings, embedded objects, connections, slicers, controls, signatures and vendor extensions is not guaranteed by the reduced model serializer. Existing serializer preflight must continue to fail closed on unsupported features.
- The enhancement profile/preview/apply/undo API is wired into `POST /api/analysis/:id/enhancement` and surfaced in the Analysis Detail **Enhancement Engine** tab; apply writes verified copies and a persistent recovery snapshot, and undo refuses to overwrite a later model state. The route follows the repository's current API security model and needs authentication/authorization before untrusted network exposure. Native recalculation adapters are still not wired into a job/UI engine-selection workflow.
- The LibreOffice adapter is likewise not wired into a production worker and requires installation/configuration of the external executable.
- Recovery snapshots are not yet stored durably or connected to the application's undo endpoint; crash recovery and multi-user concurrency need database integration.
- Batch orchestration is in-memory only; no recursive folder processing, zip packaging, resumable jobs, durable queues, rate limiting or per-file download UI.
- Offline verification does not yet compare rendered workbook screenshots, recalculated values against a trusted oracle, pivot/cache refresh outcomes, chart rendering or every OOXML package part.
- Enterprise-grade test execution, real fixture corpus coverage, fuzzing, security testing, performance/memory benchmarks, Windows Excel CI and LibreOffice CI remain outstanding.

## Safety invariants

1. Never mutate the source file in place; work on disposable copies.
2. Never auto-apply ambiguous data-quality or semantic-format findings.
3. Never claim Microsoft Excel parity from LibreOffice results.
4. Never reconstruct unsupported OOXML features through the reduced model serializer; fail closed.
5. Never silently remove VBA or invalidate digital signatures.
6. Keep all work on `feat/safe-enhancement-engine` until the repository owner reviews and merges it. Tracking issues remain open.
