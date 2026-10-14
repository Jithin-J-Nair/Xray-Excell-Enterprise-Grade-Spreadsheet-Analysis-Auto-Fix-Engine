/* Mandatory validation for the three critical fixes.
 * Steps per workbook: (1) analysis → (2) preview → (3) apply →
 * (4) download → (5) file downloads as binary → (6) opens as valid XLSX →
 * (7) downloaded file contains the applied fixes.
 */
import * as XLSX from "@redoper1/xlsx-js-style";

const B = process.env.BASE_URL ?? "http://localhost:3000";
const results = [];

// The live smoke test uses the same configured access gate as a production
// deployment. Never bake real credentials into this script or the repository.
const authUser = process.env.XRAY_BASIC_AUTH_USER;
const authPassword = process.env.XRAY_BASIC_AUTH_PASSWORD;
if (authUser && authPassword) {
  const nativeFetch = globalThis.fetch.bind(globalThis);
  globalThis.fetch = (input, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set("authorization", `Basic ${Buffer.from(`${authUser}:${authPassword}`).toString("base64")}`);
    return nativeFetch(input, { ...init, headers });
  };
}

function setF(ws, addr, f, v) {
  let cell;
  if (typeof v === "number") cell = { t: "n", v };
  else if (typeof v === "string" && v.startsWith("#")) cell = { t: "e", v };
  else if (typeof v === "string") cell = { t: "s", v };
  else cell = { t: ws[addr]?.t ?? "n", v: ws[addr]?.v ?? 0 };
  cell.f = f;
  ws[addr] = cell;
  const range = XLSX.utils.decode_range(ws["!ref"] ?? "A1");
  const p = XLSX.utils.decode_cell(addr);
  range.e.r = Math.max(range.e.r, p.r);
  range.e.c = Math.max(range.e.c, p.c);
  ws["!ref"] = XLSX.utils.encode_range(range);
}

function makeSimple2() {
  const wb = XLSX.utils.book_new();
  const s1 = XLSX.utils.aoa_to_sheet([["Name", "Amount"], [" Alice ", 1000], ["Bob", 2000], ["Carol", "3,000"]]);
  XLSX.utils.book_append_sheet(wb, s1, "CleanMe");
  const s2 = XLSX.utils.aoa_to_sheet([["K", "V"], ["rate", 0.08]]);
  s2["!merges"] = [{ s: { r: 0, c: 0 }, e: { r: 0, c: 1 } }];
  XLSX.utils.book_append_sheet(wb, s2, "Ref");
  return { name: "simple2.xlsx", bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) };
}
function makeCircular() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["A↔B", "B↔A", "self"]]);
  setF(ws, "A2", "B2+1", 1);
  setF(ws, "B2", "A2+2", 3);
  setF(ws, "C2", "C2+1", 0);
  XLSX.utils.book_append_sheet(wb, ws, "Cycle");
  return { name: "circular.xlsx", bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) };
}
function makeExternal() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Local", "Linked"]]);
  ws["A2"] = { t: "n", v: 10 };
  setF(ws, "B2", "[Budget2023.xlsx]Sheet1!A1*A2", 500);
  XLSX.utils.book_append_sheet(wb, ws, "Main");
  return { name: "external.xlsx", bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) };
}
function makeVolatile() {
  const wb = XLSX.utils.book_new();
  const ws = XLSX.utils.aoa_to_sheet([["Dice", "Stamp", "Ptr"]]);
  setF(ws, "A2", "RANDBETWEEN(1,6)", 4);
  setF(ws, "B2", "NOW()", "2026-01-01T00:00:00.000Z");
  setF(ws, "C2", 'INDIRECT("A"&ROW())', 4);
  // SheetJS cannot serialize a formula with literally no cached value (it drops
  // valueless cells), so give TODAY() a real string cache — T004 must freeze to it.
  setF(ws, "A3", "TODAY()", "2025-12-31");
  XLSX.utils.book_append_sheet(wb, ws, "Vol");
  return { name: "volatile.xlsx", bytes: XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) };
}

const j = async (r) => r.json();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function waitStatus(url, field = "status", done = "completed", tries = 40) {
  for (let i = 0; i < tries; i++) {
    const d = await j(await fetch(url));
    if (d[field] === done) return d;
    if (d[field] === "failed") throw new Error(d.error ?? "failed");
    await sleep(700);
  }
  throw new Error("timeout waiting for " + url);
}

function check(name, ok, extra = "") {
  results.push({ name, ok, extra });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? " — " + extra : ""}`);
}

async function runCase(label, getUploadId, tools, verifyDownloaded) {
  console.log(`\n=== ${label} ===`);
  const uploadId = await getUploadId();
  const { analysisId } = await j(
    await fetch(`${B}/api/analysis`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ uploadId, options: {} }),
    })
  );
  await waitStatus(`${B}/api/analysis/${analysisId}/status`);
  check(`${label}: analysis completes`, true);

  const pv = await j(
    await fetch(`${B}/api/analysis/${analysisId}/preview`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ tools, options: {} }),
    })
  );
  const onlyTagged = pv.diffs.every((d) => tools.includes(d.ruleId));
  check(`${label}: preview diffs tagged ONLY with selected tools`, onlyTagged, [...new Set(pv.diffs.map((d) => d.ruleId))].join(",") || "empty");
  check(`${label}: preview has summary + risk delta`, typeof pv.summary.riskScoreBefore === "number" && typeof pv.summary.riskScoreAfter === "number");

  const { jobId } = await j(
    await fetch(`${B}/api/analysis/${analysisId}/apply`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ previewId: pv.previewId, exportFormats: ["xlsx", "csv", "json", "ndjson", "md"] }),
    })
  );
  const job = await waitStatus(`${B}/api/jobs/${jobId}`);
  const out = job.outputs.find((o) => o.format === "xlsx");
  check(`${label}: apply completes + output registered`, Boolean(out), out?.name);

  // (4)(5) download — via the exact endpoint the UI buttons call
  const res = await fetch(`${B}/api/outputs/${out.fileId}/download`);
  const head = {
    status: res.status,
    ct: res.headers.get("content-type"),
    cd: res.headers.get("content-disposition"),
    cc: res.headers.get("cache-control"),
  };
  const buf = Buffer.from(await res.arrayBuffer());
  const hdrOK =
    head.status === 200 &&
    head.ct === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" &&
    (head.cd ?? "").startsWith("attachment;") &&
    head.cc === "no-store";
  check(`${label}: download 200 + exact headers`, hdrOK, `ct=${head.ct}`);
  const notJson = buf.length > 2 && !(buf[0] === 0x7b && buf[1] === 0x7d); // not "{}"
  check(`${label}: body is binary (not JSON/empty)`, buf.length > 500 && notJson, `${buf.length} bytes, magic=${buf.subarray(0, 2).toString("hex")}`);

  // Verify every advertised export format through its actual download endpoint.
  for (const format of ["csv", "json", "ndjson", "md"]) {
    const other = job.outputs.find((o) => o.format === format);
    check(`${label}: ${format.toUpperCase()} output registered`, Boolean(other), other?.name);
    if (!other) continue;
    const otherRes = await fetch(`${B}/api/outputs/${other.fileId}/download`);
    const otherBytes = Buffer.from(await otherRes.arrayBuffer());
    const otherText = otherBytes.toString("utf8");
    const expectedMime = {
      csv: "text/csv; charset=utf-8",
      json: "application/json; charset=utf-8",
      ndjson: "application/x-ndjson; charset=utf-8",
      md: "text/markdown; charset=utf-8",
    }[format];
    check(`${label}: ${format.toUpperCase()} download headers + byte length`,
      otherRes.status === 200 &&
      otherRes.headers.get("content-type") === expectedMime &&
      otherRes.headers.get("content-length") === String(otherBytes.length) &&
      otherBytes.length > 0,
      `bytes=${otherBytes.length}`);
    try {
      if (format === "csv") {
        if (!otherText.startsWith("\uFEFF") || !otherText.includes("\n")) throw new Error("CSV missing UTF-8 BOM or rows");
      } else if (format === "json") {
        JSON.parse(otherText);
      } else if (format === "ndjson") {
        const rows = otherText.trim().split(/\r?\n/);
        if (!rows.length || rows.some((line) => !line.trim())) throw new Error("NDJSON contains empty rows");
        for (const line of rows) JSON.parse(line);
      } else if (!otherText.startsWith("# X-RAY://EXCEL")) {
        throw new Error("Markdown report header missing");
      }
      check(`${label}: ${format.toUpperCase()} content parses`, true);
    } catch (e) {
      check(`${label}: ${format.toUpperCase()} content parses`, false, String(e.message ?? e));
    }
  }

  // (6) opens as valid xlsx
  let wb = null;
  try {
    wb = XLSX.read(buf, { type: "buffer", cellFormula: true });
  } catch (e) {
    check(`${label}: opens in Excel (parseable)`, false, String(e));
    return;
  }
  check(`${label}: opens in Excel (parseable)`, wb.SheetNames.length > 0, `${wb.SheetNames.length} sheets`);

  // (7) fixes present
  try {
    await verifyDownloaded(wb);
    check(`${label}: downloaded file contains applied fixes`, true);
  } catch (e) {
    check(`${label}: downloaded file contains applied fixes`, false, String(e.message ?? e));
  }
}

async function uploadFile({ name, bytes }) {
  const fd = new FormData();
  fd.append("files", new Blob([bytes]), name);
  const r = await j(await fetch(`${B}/api/upload`, { method: "POST", body: fd }));
  if (!r.uploadId) throw new Error("upload failed: " + JSON.stringify(r));
  return r.uploadId;
}

async function main() {
  // 1. Monster
  await runCase(
    "monster",
    async () => {
      const r = await j(await fetch(`${B}/api/samples`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ kind: "monster" }) }));
      return r.uploadId;
    },
    ["T005", "T011", "T002", "T003", "T004"],
    async (wb) => {
      if (wb.Sheets["Sales Data"]["C18"].f !== "B18*0.08") throw new Error("C18 not normalized: " + wb.Sheets["Sales Data"]["C18"].f);
      if ((wb.Sheets["Sales Data"]["!merges"] ?? []).length !== 0) throw new Error("merges remain");
      if (wb.Sheets["P4 Report"]["C4"].f !== 'IFERROR(1/0,"")') throw new Error("IFERROR wrap missing");
      if (wb.Sheets["Sales Data"]["E8"].f !== undefined) throw new Error("external link not snapshotted");
      if (wb.Sheets["Volatile Lab"]["A2"].f !== undefined) throw new Error("volatile not frozen");
      if (!wb.SheetNames.includes("SourceData")) throw new Error("SourceData sheet missing");
    }
  );

  // 2. Simple 2-sheet
  await runCase(
    "simple-2-sheet",
    () => uploadFile(makeSimple2()),
    ["T005", "T007", "T013"],
    async (wb) => {
      if (wb.Sheets["CleanMe"]["A2"].v !== "Alice") throw new Error("trim failed: " + JSON.stringify(wb.Sheets["CleanMe"]["A2"].v));
      if (wb.Sheets["CleanMe"]["B4"].v !== 3000) throw new Error("comma number not coerced");
      if ((wb.Sheets["Ref"]["!merges"] ?? []).length !== 0) throw new Error("merge remains");
    }
  );

  // 3. Circular refs — engine must DETECT but never silently rewrite; file must still export
  await runCase(
    "circular",
    () => uploadFile(makeCircular()),
    ["T005", "T007"],
    async (wb) => {
      if (wb.Sheets["Cycle"]["A2"].f !== "B2+1") throw new Error("circular formula corrupted: " + wb.Sheets["Cycle"]["A2"].f);
    }
  );

  // 4. External links
  await runCase(
    "external",
    () => uploadFile(makeExternal()),
    ["T003"],
    async (wb) => {
      if (wb.Sheets["Main"]["B2"].f !== undefined) throw new Error("external formula not snapshotted");
      if (wb.Sheets["Main"]["B2"].v !== 500) throw new Error("snapshot value wrong: " + wb.Sheets["Main"]["B2"].v);
      if (!wb.SheetNames.includes("SourceData")) throw new Error("SourceData missing");
    }
  );

  // 5. Volatile functions
  await runCase(
    "volatile",
    () => uploadFile(makeVolatile()),
    ["T004"],
    async (wb) => {
      if (wb.Sheets["Vol"]["A2"].f !== undefined || wb.Sheets["Vol"]["A2"].v !== 4) throw new Error("A2 not frozen to cached 4");
      const a3 = wb.Sheets["Vol"]["A3"];
      if (!a3) throw new Error("A3 vanished on export");
      if (a3.f !== "TODAY()" && !(a3.f === undefined && a3.v === "2025-12-31")) {
        throw new Error("TODAY() neither preserved nor frozen to its cache: " + JSON.stringify(a3));
      }
    }
  );

  const fails = results.filter((r) => !r.ok);
  console.log(`\n================= ${results.length - fails.length}/${results.length} checks passed =================`);
  if (fails.length) {
    for (const f of fails) console.log("FAILED:", f.name);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("VALIDATION CRASHED:", e);
  process.exit(1);
});
