# Release benchmark

Generated: 2026-11-24T12:40:48.836Z

## Corpus

- Generated cases: **36**
- Runner executed: **37** (full)
- Pass / fail / skip: **37** / **0** / **0**
- Per-case latency: p50 **9 ms**, p95 **708 ms**

### By expectation

- `recalc-ok`: 13
- `export-ok`: 23

### By category

- `formula`: 13
- `clean`: 7
- `locale-jp`: 4
- `messy`: 5
- `structure`: 3
- `errors`: 1
- `external`: 1
- `formula-drift`: 1
- `scale`: 1

## Engines

- LibreOffice Calc (`soffice`) — formula recalculation smoke + corpus `recalc-ok` cases
- Microsoft Excel COM — **manual Windows only** (`npm run verify:excel-com`); not claimed by Linux CI

## Portfolio demo path

1. Start the app (`npm run build && npm start`) with Basic Auth configured.
2. Dashboard → generate **Monster** or **Japanese** sample.
3. Open Analysis → Overview (Structural Health / Detected Risk) → Workbench preview → Apply.
4. Enhancement Engine tab → profile / preview / verify (review-first formula repairs).
5. Optional: recalculate with LibreOffice when installed; download verified exports.

## Honest limits

- Structural scores are not financial correctness.
- LibreOffice results are not Microsoft Excel parity.
- Unsupported OOXML features fail closed (see blocked-hyperlink corpus case).
