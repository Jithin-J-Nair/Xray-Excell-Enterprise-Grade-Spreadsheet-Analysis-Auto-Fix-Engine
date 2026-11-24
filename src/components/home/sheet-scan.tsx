"use client";

const ROWS = [
  { sheet: "P&L", cell: "D14", bad: "#REF!", good: "=VLOOKUP(A14,Map!A:B,2,0)" },
  { sheet: "Cash", cell: "F22", bad: "circular", good: "=Cash!E22+Inflows!F22" },
  { sheet: "Ops", cell: "B8", bad: "cross-file", good: "='[ops.xlsx]Q3'!B8" },
  { sheet: "Tax", cell: "H3", bad: "NOW()", good: "=TaxRates!H3" },
  { sheet: "Summary", cell: "B2", bad: "empty SUM", good: "=SUM(P&L!G10:G40)" },
];

/**
 * Excel scan → flag → patch loop.
 * Driven by CSS keyframes (works without hydration); React only mounts markup.
 */
export function SheetScan() {
  return (
    <div className="sheet-scan" data-m-loop="3.2" aria-hidden="true">
      <div className="sheet-scan__chrome">
        <span className="sheet-scan__traffic" />
        <span className="sheet-scan__traffic" />
        <span className="sheet-scan__traffic" />
        <span className="sheet-scan__file mono">
          cashflow_FY26.xlsx
          <em className="sheet-scan__status" />
        </span>
        <span className="sheet-scan__badge" />
      </div>

      <div className="sheet-scan__grid">
        <div className="sheet-scan__head mono">
          <span>#</span>
          <span>Sheet</span>
          <span>Cell</span>
          <span>Finding</span>
          <span>Patch</span>
        </div>
        {ROWS.map((r, i) => (
          <div key={r.cell} className="sheet-scan__row" style={{ ["--i" as string]: i }}>
            <span className="mono">{i + 1}</span>
            <span>{r.sheet}</span>
            <span className="mono">{r.cell}</span>
            <span className="mono sheet-scan__finding">
              <span className="sheet-scan__bad">{r.bad}</span>
              <span className="sheet-scan__good">{r.good}</span>
            </span>
            <span className="sheet-scan__patch">
              <span className="sheet-scan__idle">—</span>
              <span className="sheet-scan__warn">risk</span>
              <span className="sheet-scan__check">patched</span>
            </span>
            <span className="sheet-scan__beam" />
          </div>
        ))}
      </div>

      <div className="sheet-scan__footer mono">
        <span>
          edges mapped <b className="sheet-scan__edges">1,842</b>
        </span>
        <span>
          patches <b className="sheet-scan__patches">5/5</b>
        </span>
        <span>
          reverse queue <b className="sheet-scan__queue">5</b>
        </span>
      </div>
    </div>
  );
}
