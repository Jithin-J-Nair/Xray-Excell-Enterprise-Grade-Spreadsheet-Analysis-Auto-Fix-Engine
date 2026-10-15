import {describe,it} from "node:test";
import assert from "node:assert/strict";
import type {WorkbookModel} from "../src/lib/excel/types";
import {applyFormattingTheme,inspectStyleConsistency} from "../src/lib/excel/enhancement/formatting";
import {profileWorkbookQuality} from "../src/lib/excel/enhancement/data-quality";
function fixture():WorkbookModel{return {fileId:"f",fileName:"fixture.xlsx",names:[],sheets:[{name:"Sales",visibility:"visible",rows:4,cols:3,merges:[],cells:{
A1:{a:"A1",r:0,c:0,t:"s",v:"Item"},B1:{a:"B1",r:0,c:1,t:"s",v:"Quantity"},C1:{a:"C1",r:0,c:2,t:"s",v:"Date"},
A2:{a:"A2",r:1,c:0,t:"s",v:"Widget",s:{font:{bold:true,color:{rgb:"FF00FF00"}}}},B2:{a:"B2",r:1,c:1,t:"s",v:"12"},C2:{a:"C2",r:1,c:2,t:"s",v:"2024-03-01"},
A3:{a:"A3",r:2,c:0,t:"n",v:5},B3:{a:"B3",r:2,c:1,t:"n",v:-2},C3:{a:"C3",r:2,c:2,t:"s",v:"1899-01-01"},
A4:{a:"A4",r:3,c:0,t:"s",v:"Widget"},B4:{a:"B4",r:3,c:1,t:"s",v:"12"},C4:{a:"C4",r:3,c:2,t:"s",v:"2024-03-01"}
}}]};}
describe("enhancement formatting engine",()=>{
 it("styles headers, bounds widths, preserves styles and leaves input immutable",()=>{const m=fixture(),before=JSON.stringify(m),r=applyFormattingTheme(m,{minColumnWidth:8,maxColumnWidth:30});assert.notEqual(JSON.stringify(r.model),before);assert.deepEqual(m.sheets[0].cells.A2.s,{font:{bold:true,color:{rgb:"FF00FF00"}}});assert.equal((r.model.sheets[0].cells.A1.s?.font as {bold?:boolean}).bold,true);assert.ok(r.model.sheets[0].columnWidths?.every(w=>(w.wch??0)>=8&&(w.wch??0)<=30));assert.ok(r.changes.length>0);});
 it("rejects invalid width bounds",()=>assert.throws(()=>applyFormattingTheme(fixture(),{minColumnWidth:20,maxColumnWidth:10}),/INVALID_WIDTH_BOUNDS/));
 it("inspects styles without mutation",()=>{const s=fixture().sheets[0],before=JSON.stringify(s),r=inspectStyleConsistency(s);assert.equal(r.styledCells,1);assert.equal(r.distinctStyles,1);assert.equal(JSON.stringify(s),before);});
});
describe("read-only data-quality profiler",()=>{
 it("detects mixed types, numeric text, suspicious date, negative quantity and duplicates",()=>{const r=profileWorkbookQuality(fixture(),{keyColumns:{Sales:[0]}}),codes=new Set<string>(r.findings.map(f=>f.code));for(const code of ["MIXED_TYPES","NUMBER_AS_TEXT","DATE_AS_TEXT","SUSPICIOUS_NEGATIVE","POSSIBLE_DUPLICATE_ROW"])assert.ok(codes.has(code),"missing "+code);assert.ok(r.findings.every(f=>!f.repairable));assert.ok(r.columns.some(c=>c.header==="Quantity"));});
 it("flags missing required keys",()=>{const m=fixture();m.sheets[0].cells.A2.v="";const r=profileWorkbookQuality(m,{keyColumns:{Sales:[0]},duplicateRowScan:false});assert.ok(r.findings.some(f=>f.code==="MISSING_KEY"));});
});