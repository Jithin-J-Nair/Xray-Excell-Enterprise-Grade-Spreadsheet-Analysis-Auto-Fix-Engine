import type { CellModel, WorkbookModel } from "../types";
export type InferredColumnType = "empty"|"text"|"number"|"date"|"boolean"|"mixed";
export interface QualityFinding { code:"MIXED_TYPES"|"NUMBER_AS_TEXT"|"DATE_AS_TEXT"|"INVALID_DATE_TEXT"|"SUSPICIOUS_NEGATIVE"|"POSSIBLE_DUPLICATE_ROW"|"MISSING_KEY"; severity:"info"|"warning"|"error"; sheet:string; cell?:string; column?:number; message:string; evidence:Record<string,string|number|boolean|null>; repairable:false }
export interface ColumnProfile { sheet:string; column:number; header:string; inferredType:InferredColumnType; nonEmpty:number; typeCounts:Record<string,number> }
export interface QualityOptions { keyColumns?:Record<string,number[]>; quantityHeaderPattern?:RegExp; duplicateRowScan?:boolean }
const DATE=/^(?:\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{4}年\d{1,2}月\d{1,2}日)$/;
const NUM=/^[-+]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?%?$/;
const empty=(c:CellModel)=>c.v===null||c.v==="";
function validDateText(value: string): boolean {
 const western=/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/.exec(value);
 const japanese=/^(\d{4})年(\d{1,2})月(\d{1,2})日$/.exec(value);
 const match=western??japanese;
 if(!match)return false;
 const year=Number(match[1]),month=Number(match[2]),day=Number(match[3]);
 const date=new Date(Date.UTC(year,month-1,day));
 return date.getUTCFullYear()===year&&date.getUTCMonth()===month-1&&date.getUTCDate()===day;
}
function typeOf(c:CellModel):string {
 if(empty(c))return "empty"; if(c.t==="b"||typeof c.v==="boolean")return "boolean";
 if(c.t==="d"||(typeof c.v==="string"&&DATE.test(c.v)))return "date";
 if(c.t==="n"||typeof c.v==="number")return "number";
 if(typeof c.v==="string"&&NUM.test(c.v.trim()))return "numeric-text"; return "text";
}
function infer(types:string[]):InferredColumnType {const set=new Set(types.filter(x=>x!=="empty").map(x=>x==="numeric-text"?"number":x));if(!set.size)return "empty";if(set.size>1)return "mixed";return [...set][0] as InferredColumnType;}

/** Read-only profiler: findings are never applied automatically. */
export function profileWorkbookQuality(model:WorkbookModel, options:QualityOptions={}):{columns:ColumnProfile[];findings:QualityFinding[]} {
 const columns:ColumnProfile[]=[],findings:QualityFinding[]=[],quantity=options.quantityHeaderPattern??/quantity|qty|count|units|items|数量/i;
 for(const sheet of model.sheets){
  const headers=new Map<number,string>();for(const c of Object.values(sheet.cells))if(c.r===0&&typeof c.v==="string")headers.set(c.c,c.v.trim());
  for(let col=0;col<sheet.cols;col++){
   const cells=Object.values(sheet.cells).filter(c=>c.c===col&&c.r>0&&!empty(c)),types=cells.map(typeOf),counts:Record<string,number>={};
   for(const t of types)counts[t]=(counts[t]??0)+1;
   const header=headers.get(col)??"",inferredType=infer(types);
   if(cells.length)columns.push({sheet:sheet.name,column:col,header,inferredType,nonEmpty:cells.length,typeCounts:counts});
   if(inferredType==="mixed")findings.push({code:"MIXED_TYPES",severity:"warning",sheet:sheet.name,column:col,message:"Column "+(header||col+1)+" contains mixed data types.",evidence:{header,typeCounts:JSON.stringify(counts)},repairable:false});
   for(const c of cells){
    const t=typeOf(c);
    if(t==="numeric-text")findings.push({code:"NUMBER_AS_TEXT",severity:"info",sheet:sheet.name,cell:c.a,column:col,message:"Numeric-looking text may need normalization; locale and identifier semantics require review.",evidence:{value:String(c.v),header},repairable:false});
    if(t==="date"&&typeof c.v==="string"&&DATE.test(c.v)){
     if(!validDateText(c.v)) findings.push({code:"INVALID_DATE_TEXT",severity:"error",sheet:sheet.name,cell:c.a,column:col,message:"Date-shaped text is not a valid calendar date; no automatic correction was attempted.",evidence:{value:c.v,header},repairable:false});
     else {const year=Number(c.v.match(/^\d{4}/)?.[0]??0);if(year>0&&(year<1900||year>new Date().getFullYear()+20))findings.push({code:"DATE_AS_TEXT",severity:"warning",sheet:sheet.name,cell:c.a,column:col,message:"Date text contains an unusual year; confirm locale and century before repair.",evidence:{value:c.v,year},repairable:false});}
    }
    if(quantity.test(header)&&typeof c.v==="number"&&c.v<0)findings.push({code:"SUSPICIOUS_NEGATIVE",severity:"warning",sheet:sheet.name,cell:c.a,column:col,message:"Negative quantity-like value requires domain review; returns and corrections may be valid.",evidence:{value:c.v,header},repairable:false});
   }
  }
  if(options.duplicateRowScan??true){const seen=new Map<string,number>();for(let r=1;r<sheet.rows;r++){const vals=Object.values(sheet.cells).filter(c=>c.r===r).sort((a,b)=>a.c-b.c).map(c=>c.v);if(!vals.length||vals.every(v=>v===null||v===""))continue;const key=JSON.stringify(vals),first=seen.get(key);if(first!==undefined)findings.push({code:"POSSIBLE_DUPLICATE_ROW",severity:"warning",sheet:sheet.name,message:"Row "+(r+1)+" duplicates row "+(first+1)+"; confirm whether accidental.",evidence:{row:r+1,firstRow:first+1},repairable:false});else seen.set(key,r);}}
  for(const col of options.keyColumns?.[sheet.name]??[])for(let r=1;r<sheet.rows;r++){const c=Object.values(sheet.cells).find(x=>x.r===r&&x.c===col);if(!c||empty(c))findings.push({code:"MISSING_KEY",severity:"error",sheet:sheet.name,cell:c?.a,column:col,message:"Required key is missing at row "+(r+1)+".",evidence:{row:r+1,column:col},repairable:false});}
 }
 return {columns,findings};
}