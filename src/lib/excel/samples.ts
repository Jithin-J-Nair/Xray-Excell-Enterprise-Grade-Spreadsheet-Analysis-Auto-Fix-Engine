// ── Demo / QA datasets: "monster" workbook + Japanese messy workbook ─────────
import * as XLSX from "xlsx";

function setF(ws: XLSX.WorkSheet, addr: string, f: string, v?: string | number) {
  let cell: XLSX.CellObject;
  if (typeof v === "number") {
    cell = { t: "n", v };
  } else if (typeof v === "string" && /^#/.test(v)) {
    cell = { t: "e", v } as XLSX.CellObject;
  } else if (typeof v === "string") {
    cell = { t: "s", v } as XLSX.CellObject;
  } else {
    const prev = ws[addr] as XLSX.CellObject | undefined;
    cell = { t: (prev?.t as XLSX.CellObject["t"]) ?? "n", v: prev?.v ?? 0 } as XLSX.CellObject;
  }
  cell.f = f;
  ws[addr] = cell;
  // SheetJS only serializes cells inside !ref — grow the range
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const pos = XLSX.utils.decode_cell(addr);
  range.s.r = Math.min(range.s.r, pos.r);
  range.s.c = Math.min(range.s.c, pos.c);
  range.e.r = Math.max(range.e.r, pos.r);
  range.e.c = Math.max(range.e.c, pos.c);
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function aoa(aoa: unknown[][]): XLSX.WorkSheet {
  return XLSX.utils.aoa_to_sheet(aoa);
}

export interface SampleDef {
  kind: "monster" | "jp";
  fileName: string;
  bytes: () => Uint8Array;
}

export const SAMPLES: SampleDef[] = [
  {
    kind: "monster",
    fileName: "Monster_FY2024_Budget_v17_FINAL_final2.xlsx",
    bytes: buildMonster,
  },
  {
    kind: "jp",
    fileName: "売上データ_2024_確認済(最新).xlsx",
    bytes: buildJapanese,
  },
];


export function buildMonster(): Uint8Array {
  const wb = XLSX.utils.book_new();

  // 1. Dashboard — merged title, cross-sheet KPIs, ref to very-hidden sheet
  const dash = aoa([
    ["FY2024 BUDGET — EXECUTIVE DASHBOARD", "", "", "", ""],
    ["", "", "", "", ""],
    ["Total Sales", "", "Net Profit", "", "Hidden Calc", ""],
    ["", "", "", "", "", ""],
    ["Volatile Stamp", "", "", "", "", ""],
  ]);
  dash["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }];
  setF(dash, "A3", "'Sales Data'!B31", 932450);
  setF(dash, "C3", "'Sales Data'!B31*0.125-'Sales Data'!B32", 0);
  setF(dash, "E3", "'VeryHidden Calc'!A1", 42);
  setF(dash, "A5", "NOW()", new Date("2026-02-14T09:00:00Z").toISOString());
  XLSX.utils.book_append_sheet(wb, dash, "Dashboard");

  // 2. Sales Data — hardcoded tax literals, one inconsistent formula, external link
  const sales: unknown[][] = [["Region", "Revenue", "Tax", "Total", "Note"]];
  const regions = ["North", "South", "East", "West", "Central", "Intl"];
  for (let i = 0; i < 30; i++) {
    sales.push([regions[i % regions.length], 15000 + ((i * 1373) % 42000), "", "", i === 7 ? "see Budget2023" : ""]);
  }
  const salesWs = aoa(sales);
  for (let r = 2; r <= 31; r++) {
    setF(salesWs, `C${r}`, r === 18 ? `B${r}*0.1` : `B${r}*0.08`, r * 100); // inconsistent at row 18
    setF(salesWs, `D${r}`, `B${r}+C${r}`, 0);
  }
  setF(salesWs, "B31", "SUM(B2:B30)", 932450);
  setF(salesWs, "B32", "SUM(C2:C30)", 74596);
  setF(salesWs, "E8", "[Budget2023.xlsx]Sheet1!A1*B8", 0); // unresolved external link
  salesWs["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 4 } }].map((m) => ({ s: m.s, e: m.e })); // merged header over data range
  XLSX.utils.book_append_sheet(wb, salesWs, "Sales Data");

  // 3. Circular — real cycle + self loop
  const circ = aoa([["A depends on B", "B depends on A", "Self loop"], ["", "", ""]]);
  setF(circ, "A2", "B2+1", 1);
  setF(circ, "B2", "A2+2", 3);
  setF(circ, "C2", "C2+1", 0);
  XLSX.utils.book_append_sheet(wb, circ, "Circular");

  // 4. Volatile Lab
  const vol = aoa([["Dice", "Today", "Stamp", "Indirect"]]);
  setF(vol, "A2", "RANDBETWEEN(1,6)", 4);
  setF(vol, "B2", "TODAY()-DATE(2024,1,1)", 45);
  setF(vol, "C2", "NOW()", new Date().toISOString());
  setF(vol, "D2", "INDIRECT(\"A\"&ROW())", 4);
  setF(vol, "A3", "RANDBETWEEN(1,6)", 2);
  XLSX.utils.book_append_sheet(wb, vol, "Volatile Lab");

  // 5. Transactions — duplicate rows
  const txn: unknown[][] = [["TxnID", "Date", "Account", "Amount"]];
  for (let i = 1; i <= 24; i++) {
    const row = [`T-${1000 + i}`, "2024-03-15", `ACC-${200 + (i % 5)}`, 1200 + (i % 7) * 130];
    txn.push(row);
    if (i === 6 || i === 11 || i === 11 + 0 || i === 19) txn.push([...row]); // duplicates
  }
  txn.push(["T-1006", "2024-03-15", "ACC-201", 1200 + 6 % 7 * 130]);
  XLSX.utils.book_append_sheet(wb, aoa(txn), "Transactions");

  // 6. Expenses — numbers as text, mixed types, whitespace
  const exp: unknown[][] = [["Item", "Amount"]];
  const items = ["Servers", "Consulting", "Software", "Travel", "Offsite", "Hardware", "Legal", "PR"];
  for (let i = 0; i < items.length; i++) {
    exp.push([i === 3 ? ` ${items[i]} ` : items[i], i % 3 === 0 ? `${((i + 4) * 1234567).toLocaleString("en-US")}` : i % 3 === 1 ? (i + 4) * 1278 : "n/a"]);
  }
  const expWs = aoa(exp);
  XLSX.utils.book_append_sheet(wb, expWs, "Expenses");

  // 7. VeryHidden Calc (very hidden, referenced by Dashboard)
  const vh = aoa([["internal rate"], [0.125]]);
  XLSX.utils.book_append_sheet(wb, vh, "VeryHidden Calc");

  // 8. Hidden lookup
  const lookup = aoa([["Code", "Desc"], ["A", "Alpha"], ["B", "Beta"]]);
  XLSX.utils.book_append_sheet(wb, lookup, "LookupTables");

  // 9-19. Quarterly filler sheets with cross-sheet formulas
  for (let q = 1; q <= 12; q++) {
    const ws = aoa([
      [`P${q} Report`, "", ""],
      ["Metric", "Value", "Ref"],
      ["Revenue", q * 10000, ""],
      ["Headcount", q * 3, ""],
    ]);
    setF(ws, "C3", `'Sales Data'!B${2 + (q % 28)}`, q * 999);
    if (q % 4 === 0) setF(ws, "C4", "1/0", "#DIV/0!");
    XLSX.utils.book_append_sheet(wb, ws, `P${q} Report`);
  }

  // 20. Long formula sheet
  const long_ = aoa([["KPI"]]);
  setF(
    long_,
    "A2",
    "IF('Sales Data'!B2>10000,IF('Sales Data'!B3>20000,IF('Sales Data'!B4>30000,IF('Sales Data'!B5>40000,'Sales Data'!B6*0.08+'Sales Data'!B7*0.08+'Sales Data'!B8*0.08+'Sales Data'!B9*0.08+'Sales Data'!B10*0.08+'Sales Data'!B11*0.08+'Sales Data'!B12*0.08+'Sales Data'!B13*0.08,SUM('Sales Data'!B2:B13)*0.07),SUM('Sales Data'!B2:B13)*0.06),SUM('Sales Data'!B2:B13)*0.05),SUM('Sales Data'!B2:B13)*0.04)+IFERROR(SUM('Sales Data'!C2:C30)/MAX(1,SUM('Sales Data'!B2:B30)),0)*100",
    0
  );
  XLSX.utils.book_append_sheet(wb, long_, "KPI Engine");

  // 21. Empty sheet
  XLSX.utils.book_append_sheet(wb, aoa([]), "Empty Sheet");

  // defined names incl. a broken one + duplicate, plus visibility flags
  wb.Workbook = {
    Sheets: wb.SheetNames.map((name) => ({
      Hidden: name === "VeryHidden Calc" ? 2 : name === "LookupTables" ? 1 : 0,
    })),
    Names: [
      { Name: "TAX_RATE", Ref: "'VeryHidden Calc'!$A$2" },
      { Name: "TAX_RATE_OLD", Ref: "#REF!" },
      { Name: "SalesTotal", Ref: "'Sales Data'!$B$31" },
      { Name: "SalesTotal", Ref: "'Sales Data'!$B$31" },
    ],
  } as NonNullable<XLSX.WorkBook["Workbook"]>;

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array | ArrayBuffer;
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

export function buildJapanese(): Uint8Array {
  const wb = XLSX.utils.book_new();
  const NBSP = " ";
  const head = ["日付", "店舗名", "商品", "数量", "単価", "金額"];
  const rows: unknown[][] = [
    ["売上データ（2024年度・確定版）", "", "", "", "", ""],
    head,
  ];
  const shops = ["ＴＯＫＹＯ店", "大阪店 ", `${NBSP}名古屋店`, "福岡店", "　札幌店"];
  const items = ["りんご", "みかん", "バナナ", "ぶどう", "メロン"];
  const dates = ["2024年3月5日", "2024/04/12", "2024-05-23", "2024年6月1日", "2024/07/30"];
  for (let i = 0; i < 24; i++) {
    rows.push([
      dates[i % dates.length],
      shops[i % shops.length],
      items[i % items.length],
      1 + (i % 9),
      100 + (i % 5) * 40,
      "",
    ]);
  }
  const ws = aoa(rows);
  for (let r = 3; r <= 26; r++) {
    setF(ws, `F${r}`, r === 13 ? `D${r}*E${r}*1.1` : `D${r}*E${r}`, 0); // inconsistent row 13
  }
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  // error + volatile + hardcoded tax
  setF(ws, "F27", "SUM(F3:F26)*0.1", 0);
  setF(ws, "F28", "TODAY()", new Date().toISOString());
  setF(ws, "B28", "1/0", "#DIV/0!");
  // duplicate rows
  const dupRow = ["2024年3月5日", "ＴＯＫＹＯ店", "りんご", 4, 180, ""];
  rows.push(dupRow, [...dupRow], [...dupRow]);
  // numbers-as-text column
  const memo: unknown[][] = [["月", "累計売上メモ"]];
  for (let i = 1; i <= 12; i++) memo.push([`${i}月`, `${(1234567 + i * 111111).toLocaleString("en-US")}`]);
  ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  // rebuild sheet rows (added dup rows) → write fresh
  const ws2 = aoa(rows);
  for (let r = 3; r <= 26; r++) setF(ws2, `F${r}`, r === 13 ? `D${r}*E${r}*1.1` : `D${r}*E${r}`, 0);
  setF(ws2, "F27", "SUM(F3:F26)*0.1", 0);
  setF(ws2, "F28", "TODAY()", new Date().toISOString());
  setF(ws2, "B28", "1/0", "#DIV/0!");
  ws2["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 5 } }];
  XLSX.utils.book_append_sheet(wb, ws2, "売上データ");

  const memoWs = aoa(memo);
  XLSX.utils.book_append_sheet(wb, memoWs, "売上メモ");

  const hidden = aoa([["社内レート"], [0.1]]);
  setF(hidden, "A2", "'売上データ'!F27*0.5", 0);
  XLSX.utils.book_append_sheet(wb, hidden, "社内メモ");

  wb.Workbook = {
    Sheets: wb.SheetNames.map((n) => ({ Hidden: n === "社内メモ" ? 1 : 0 })),
    Names: [
      { Name: "税率", Ref: "社内メモ!$A$2" },
      { Name: "旧税率", Ref: "#REF!" },
    ],
  } as typeof wb.Workbook;

  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array | ArrayBuffer;
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}
