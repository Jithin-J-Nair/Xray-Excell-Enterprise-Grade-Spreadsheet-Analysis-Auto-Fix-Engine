// ── Formula tokenizer & R1C1 abstract/instantiate utilities (isomorphic) ─────
import type { FormulaRef, ParsedFormula } from "./types";

const MAX_ROW = 1048576;
const MAX_COL = 16384;

export function colToName(c: number): string {
  let s = "";
  c += 1;
  while (c > 0) {
    const m = (c - 1) % 26;
    s = String.fromCharCode(65 + m) + s;
    c = Math.floor((c - 1) / 26);
  }
  return s;
}

export function nameToCol(name: string): number {
  let c = 0;
  for (let i = 0; i < name.length; i++) {
    c = c * 26 + (name.charCodeAt(i) - 64);
  }
  return c - 1;
}

export function addrOf(r: number, c: number): string {
  return `${colToName(c)}${r + 1}`;
}

export function parseAddr(a: string): { r: number; c: number } | null {
  const m = /^([A-Za-z]{1,3})([0-9]{1,7})$/.exec(a);
  if (!m) return null;
  return { r: parseInt(m[2], 10) - 1, c: nameToCol(m[1].toUpperCase()) };
}

/**
 * Combined token recognizer. Group layout:
 *  1: string literal                              "..." with "" escapes
 *  2: sheet prefix (with trailing !)             'My Sheet'! | Sheet1! | [Book]Sheet1! | [1]Sheet1!
 *  3..6: first ref part  $COL $ROW
 *  7..10: optional range end  $COL $ROW
 *  11: function name (lookahead for paren)
 *  12: numeric literal
 *  13: bare identifier (named-range candidate)
 *
 * The ref branch carries a trailing boundary lookahead so function names that
 * look like refs (LOG10, ATAN2, FALSE-ish cols) are never eaten as refs.
 */
const RE =
  /("(?:[^"]|"")*")|((?:'(?:[^']|'')*'|\[[^\]]*\][^'!\s\]\[]*|[\p{L}_][\p{L}\p{N}_.]*)!)?(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7})(?::(\$?)([A-Za-z]{1,3})(\$?)([0-9]{1,7}))?(?![\p{L}\p{N}(])|([A-Za-z_][A-Za-z0-9_.]*)(?=\()|(?<![\p{L}\p{N}_.$])([0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)|([A-Za-z_][A-Za-z0-9_.]*)/gu;

interface RawToken {
  index: number;
  len: number;
  kind: "string" | "ref" | "func" | "num" | "ident";
  text: string;
  ref?: FormulaRef;
  fn?: string;
  num?: string;
  ident?: string;
}

function stripSheetPrefix(prefix: string | undefined): { sheet: string | null; book: string | null } {
  if (!prefix) return { sheet: null, book: null };
  let p = prefix.slice(0, -1); // drop "!"
  let book: string | null = null;
  const bm = /^\[([^\]]*)\]/.exec(p);
  if (bm) {
    book = bm[1];
    p = p.slice(bm[0].length);
  }
  let sheet: string;
  if (p.startsWith("'")) {
    sheet = p.slice(1, -1).replace(/''/g, "'");
  } else {
    sheet = p;
  }
  return { sheet, book };
}

export function tokenizeFormula(f: string): RawToken[] {
  const out: RawToken[] = [];
  RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = RE.exec(f)) !== null) {
    const idx = m.index;
    if (m[1] !== undefined) {
      out.push({ index: idx, len: m[1].length, kind: "string", text: m[1] });
    } else if (m[4] !== undefined) {
      const col = nameToCol(m[4].toUpperCase());
      const row = parseInt(m[6], 10) - 1;
      let col2 = col;
      let row2 = row;
      if (m[8] !== undefined) {
        col2 = nameToCol(m[8].toUpperCase());
        row2 = parseInt(m[10], 10) - 1;
      }
      if (row + 1 > MAX_ROW || col + 1 > MAX_COL || row2 + 1 > MAX_ROW || col2 + 1 > MAX_COL) {
        out.push({ index: idx, len: m[0].length, kind: "ident", text: m[0], ident: m[0] });
        continue;
      }
      const { sheet, book } = stripSheetPrefix(m[2]);
      const raw = m[0];
      const ref: FormulaRef = {
        raw,
        sheet,
        book,
        r1: Math.min(row, row2),
        c1: Math.min(col, col2),
        r2: Math.max(row, row2),
        c2: Math.max(col, col2),
        absRow1: m[5] === "$",
        absCol1: m[3] === "$",
        absRow2: m[8] !== undefined ? m[9] === "$" : m[5] === "$",
        absCol2: m[8] !== undefined ? m[7] === "$" : m[3] === "$",
      };
      out.push({ index: idx, len: raw.length, kind: "ref", text: raw, ref });
    } else if (m[11] !== undefined) {
      out.push({ index: idx, len: m[11].length, kind: "func", text: m[11], fn: m[11].toUpperCase() });
    } else if (m[12] !== undefined) {
      out.push({ index: idx, len: m[12].length, kind: "num", text: m[12], num: m[12] });
    } else if (m[13] !== undefined) {
      out.push({ index: idx, len: m[13].length, kind: "ident", text: m[13], ident: m[13] });
    }
  }
  return out;
}

export function parseFormula(f: string): ParsedFormula {
  const toks = tokenizeFormula(f);
  const res: ParsedFormula = { refs: [], functions: [], numbers: [], identifiers: [] };
  for (const t of toks) {
    if (t.kind === "ref" && t.ref) res.refs.push(t.ref);
    else if (t.kind === "func" && t.fn) res.functions.push(t.fn);
    else if (t.kind === "num" && t.num) res.numbers.push(t.num);
    else if (t.kind === "ident" && t.ident) res.identifiers.push(t.ident);
  }
  res.functions = [...new Set(res.functions)];
  res.identifiers = [...newSet(res.identifiers)].filter(
    (x) => !["TRUE", "FALSE"].includes(x.toUpperCase())
  );
  return res;
}

function newSet<T>(a: T[]): T[] {
  return [...new Set(a)];
}

// ── R1C1 abstraction / instantiation ─────────────────────────────────────────
// A formula relative to (r,c) becomes a template with markers:
//   ⟦s:⟫sheetName⟧ ⟦b:⟫bookName⟧ R⟨+n|*n⟩C⟨+n|*n⟩  (* = absolute)
// plus paired range marker tokens separated by ":".

const M = "⟦";

function refToMarker(ref: FormulaRef, baseR: number, baseC: number, which: 1 | 2): string {
  const r = which === 1 ? ref.r1 : ref.r2;
  const c = which === 1 ? ref.c1 : ref.c2;
  const absR = which === 1 ? ref.absRow1 : ref.absRow2;
  const absC = which === 1 ? ref.absCol1 : ref.absCol2;
  return `${rPart(absR, r, baseR)}${cPart(absC, c, baseC)}`;
}
function rPart(abs: boolean, r: number, baseR: number): string {
  if (abs) return `R${r + 1}`;
  const d = r - baseR;
  return d === 0 ? "R" : `R[${d > 0 ? "+" : ""}${d}]`;
}
function cPart(abs: boolean, c: number, baseC: number): string {
  if (abs) return `C${c + 1}`;
  const d = c - baseC;
  return d === 0 ? "C" : `C[${d > 0 ? "+" : ""}${d}]`;
}

/** Convert an A1-style formula to a relocatable R1C1-ish template. */
export function abstractFormula(f: string, baseR: number, baseC: number): string {
  const toks = tokenizeFormula(f);
  let out = "";
  let pos = 0;
  for (const t of toks) {
    out += f.slice(pos, t.index);
    if (t.kind === "ref" && t.ref) {
      const ref = t.ref;
      let marker = M;
      if (ref.book) marker += `b:${ref.book}⟧`;
      if (ref.sheet) marker += `s:${ref.sheet.replace(/⟧/g, "")}⟧`;
      marker += refToMarker(ref, baseR, baseC, 1);
      const isRange = ref.r1 !== ref.r2 || ref.c1 !== ref.c2;
      if (isRange) marker += ":" + refToMarker(ref, baseR, baseC, 2);
      marker += "⟧";
      out += marker;
    } else {
      out += t.text;
    }
    pos = t.index + t.len;
  }
  out += f.slice(pos);
  return out;
}

const TEMPLATE_RE = /⟦((?:[sb]:[^⟧]+⟧)*)(R(?:\[[+-]?\d+\]|\d+)?C(?:\[[+-]?\d+\]|\d+)?(?::R(?:\[[+-]?\d+\]|\d+)?C(?:\[[+-]?\d+\]|\d+)?)?)⟧/g;

/** Instantiate a template produced by abstractFormula at (r,c). */
export function instantiateTemplate(tpl: string, r: number, c: number): string {
  return tpl.replace(TEMPLATE_RE, (_all, prefixes: string, body: string) => {
    let pre = "";
    const preRe = /([sb]):([^⟧]+)⟧/g;
    let pm: RegExpExecArray | null;
    while ((pm = preRe.exec(prefixes)) !== null) {
      if (pm[1] === "b") pre += `[${pm[2]}]`;
      else {
        const s = pm[2];
        pre += /^[A-Za-z_][A-Za-z0-9_.]*$/.test(s) ? `${s}!` : `'${s.replace(/'/g, "''")}'!`;
      }
    }
    const parts = body.split(":");
    const rc = (tok: string): string => {
      const m = /^R(?:\[([+-]?\d+)\]|(\d+))?C(?:\[([+-]?\d+)\]|(\d+))?$/.exec(tok);
      if (!m) return tok;
      const rowAbs = m[2] !== undefined;
      const colAbs = m[4] !== undefined;
      const row = rowAbs ? parseInt(m[2], 10) : m[1] !== undefined ? r + parseInt(m[1], 10) + 1 : r + 1;
      const col = colAbs ? parseInt(m[4], 10) : m[3] !== undefined ? c + parseInt(m[3], 10) + 1 : c + 1;
      return `${colAbs ? "$" : ""}${colToName(col - 1)}${rowAbs ? "$" : ""}${row}`;
    };
    if (parts.length === 2) return pre + rc(parts[0]) + ":" + rc(parts[1]);
    return pre + rc(parts[0]);
  });
}

/** Replace numeric literal tokens (=== literal) inside a formula with `replacement`. */
export function replaceNumberLiteral(f: string, literal: string, replacement: string): string {
  const toks = tokenizeFormula(f);
  let out = "";
  let pos = 0;
  for (const t of toks) {
    out += f.slice(pos, t.index);
    if (t.kind === "num" && t.num === literal) out += replacement;
    else out += t.text;
    pos = t.index + t.len;
  }
  out += f.slice(pos);
  return out;
}
