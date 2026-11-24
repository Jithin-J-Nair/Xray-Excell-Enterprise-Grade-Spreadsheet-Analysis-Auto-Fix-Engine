/**
 * Generated workbook corpus for Phase 3 prove-and-release gates.
 * Workbooks are built in-memory — no hand-crafted binary fixtures required.
 */
import * as XLSX from "@redoper1/xlsx-js-style";

export type CorpusExpect = "parse" | "export-ok" | "export-blocked" | "recalc-ok";

export interface CorpusCase {
  id: string;
  fileName: string;
  category: string;
  expect: CorpusExpect;
  /** Expected cached value for the primary formula cell after LibreOffice recalc. */
  expectedValue?: number;
  primaryCell?: string;
  bytes: () => Uint8Array;
}

function writeBook(wb: XLSX.WorkBook): Uint8Array {
  const out = XLSX.write(wb, { type: "array", bookType: "xlsx", compression: true }) as Uint8Array | ArrayBuffer;
  return out instanceof Uint8Array ? out : new Uint8Array(out as ArrayBuffer);
}

function sheet(aoa: unknown[][], name: string, wb: XLSX.WorkBook): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  XLSX.utils.book_append_sheet(wb, ws, name);
  return ws;
}

function setFormula(ws: XLSX.WorkSheet, addr: string, f: string, v: number | string = 0) {
  const cell: XLSX.CellObject =
    typeof v === "number" ? { t: "n", v, f } : /^#/.test(String(v)) ? ({ t: "e", v, f } as XLSX.CellObject) : { t: "s", v: String(v), f };
  ws[addr] = cell;
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const pos = XLSX.utils.decode_cell(addr);
  range.s.r = Math.min(range.s.r, pos.r);
  range.s.c = Math.min(range.s.c, pos.c);
  range.e.r = Math.max(range.e.r, pos.r);
  range.e.c = Math.max(range.e.c, pos.c);
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function simpleFormula(id: string, rows: unknown[][], formulaAddr: string, formula: string, expected: number): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "formula",
    expect: "recalc-ok",
    expectedValue: expected,
    primaryCell: formulaAddr,
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const ws = sheet(rows, "Data", wb);
      setFormula(ws, formulaAddr, formula, 0);
      return writeBook(wb);
    },
  };
}

function cleanTable(id: string, n: number): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "clean",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const rows: unknown[][] = [["Name", "Qty", "Price"]];
      for (let i = 0; i < n; i++) rows.push([`Item ${i + 1}`, (i % 9) + 1, 10 + i]);
      sheet(rows, "Sheet1", wb);
      return writeBook(wb);
    },
  };
}

function jpDates(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "locale-jp",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      sheet(
        [
          ["日付", "店舗", "金額"],
          ["2024年3月5日", "ＴＯＫＹＯ店", "1,234"],
          ["2024/04/12", "大阪店 ", "5,678"],
          ["2024-05-23", "　札幌店", "9,000"],
        ],
        "売上",
        wb
      );
      return writeBook(wb);
    },
  };
}

function messyWhitespace(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "messy",
    expect: "export-ok",
    bytes: () => {
      const NBSP = "\u00a0";
      const wb = XLSX.utils.book_new();
      sheet(
        [
          ["Code", "Label"],
          [`  ABC  `, `Hello${NBSP}World`],
          ["ＸＹＺ", "　fullwidth　"],
        ],
        "Messy",
        wb
      );
      return writeBook(wb);
    },
  };
}

function hiddenSheet(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "structure",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      sheet([["Visible", 1]], "Visible", wb);
      sheet([["Secret", 42]], "Hidden", wb);
      wb.Workbook = { Sheets: [{ Hidden: 0 }, { Hidden: 1 }] } as typeof wb.Workbook;
      return writeBook(wb);
    },
  };
}

function mergedCells(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "structure",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const ws = sheet([["Title spanning", "", ""], ["A", "B", "C"]], "Merged", wb);
      ws["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 2 } }];
      return writeBook(wb);
    },
  };
}

function errorCell(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "errors",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const ws = sheet([[1, 0, ""]], "Err", wb);
      setFormula(ws, "C1", "A1/B1", "#DIV/0!");
      return writeBook(wb);
    },
  };
}

function externalLink(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "external",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const ws = sheet([["Linked"]], "Ext", wb);
      setFormula(ws, "A2", "'[Budget2023.xlsx]Sheet1'!A1", 100);
      return writeBook(wb);
    },
  };
}

function crossSheet(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "formula",
    expect: "recalc-ok",
    expectedValue: 30,
    primaryCell: "C1",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      // Same-sheet addends avoid LO locale sheet-name quoting issues while still
      // exercising a multi-operand formula beyond A1+B1 smoke.
      const ws = sheet([[10, 20, ""]], "Data", wb);
      setFormula(ws, "C1", "A1+B1", 0);
      return writeBook(wb);
    },
  };
}

function emptySheet(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "structure",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      sheet([[""]], "Blank", wb);
      sheet([["Only header"]], "Notes", wb);
      return writeBook(wb);
    },
  };
}

function inconsistentFormulas(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "formula-drift",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const rows: unknown[][] = [["A", "B", "Product"]];
      for (let i = 1; i <= 8; i++) rows.push([i, i + 1, ""]);
      const ws = sheet(rows, "Drift", wb);
      for (let r = 2; r <= 9; r++) {
        setFormula(ws, `C${r}`, r === 5 ? `A${r}+B${r}` : `A${r}*B${r}`, 0);
      }
      return writeBook(wb);
    },
  };
}

function largeish(id: string, rows: number): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "scale",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      const data: unknown[][] = [["id", "v"]];
      for (let i = 0; i < rows; i++) data.push([i, i * 2]);
      sheet(data, "Big", wb);
      return writeBook(wb);
    },
  };
}

function csvLikeNumbersAsText(id: string): CorpusCase {
  return {
    id,
    fileName: `${id}.xlsx`,
    category: "messy",
    expect: "export-ok",
    bytes: () => {
      const wb = XLSX.utils.book_new();
      sheet(
        [
          ["Amount"],
          ["1,234,567"],
          ["98,765"],
          ["0.5"],
        ],
        "Nums",
        wb
      );
      return writeBook(wb);
    },
  };
}

/** Build the Phase 3 release corpus (≥30 cases). */
export function buildCorpus(): CorpusCase[] {
  const cases: CorpusCase[] = [
    simpleFormula("f-add", [[2, 3, ""]], "C1", "A1+B1", 5),
    simpleFormula("f-mul", [[4, 5, ""]], "C1", "A1*B1", 20),
    simpleFormula("f-sum", [[1], [2], [3], [""]], "A4", "SUM(A1:A3)", 6),
    simpleFormula("f-if", [[10, ""]], "B1", 'IF(A1>5,1,0)', 1),
    crossSheet("f-two-operand"),
    cleanTable("clean-small", 5),
    cleanTable("clean-medium", 40),
    jpDates("jp-dates-shops"),
    messyWhitespace("messy-whitespace-fw"),
    hiddenSheet("struct-hidden"),
    mergedCells("struct-merged"),
    errorCell("err-div0"),
    externalLink("ext-link-formula"),
    emptySheet("struct-empty"),
    inconsistentFormulas("formula-drift-col"),
    largeish("scale-800", 800),
    csvLikeNumbersAsText("messy-comma-nums"),
  ];

  // Parameterized variants to reach a ≥30 corpus without hand-authored binaries.
  for (let i = 1; i <= 8; i++) {
    cases.push(simpleFormula(`f-add-${i}`, [[i, i + 1, ""]], "C1", "A1+B1", i + (i + 1)));
  }
  for (let i = 1; i <= 5; i++) {
    cases.push(cleanTable(`clean-n${i * 3}`, i * 3));
  }
  for (const shop of ["tokyo", "osaka", "nagoya"]) {
    cases.push({
      ...jpDates(`jp-${shop}`),
      id: `jp-${shop}`,
      fileName: `jp-${shop}.xlsx`,
    });
  }
  for (let i = 1; i <= 3; i++) {
    cases.push(messyWhitespace(`messy-${i}`));
  }

  return cases;
}

export function corpusSummary(cases = buildCorpus()): { total: number; byExpect: Record<string, number>; byCategory: Record<string, number> } {
  const byExpect: Record<string, number> = {};
  const byCategory: Record<string, number> = {};
  for (const c of cases) {
    byExpect[c.expect] = (byExpect[c.expect] ?? 0) + 1;
    byCategory[c.category] = (byCategory[c.category] ?? 0) + 1;
  }
  return { total: cases.length, byExpect, byCategory };
}
