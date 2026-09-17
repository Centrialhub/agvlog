import {readOfxStatement} from '../_shared/finance-ofx-reader.ts';
import {readStatementCsv} from '../_shared/finance-statement-reader.ts';
import {readStatementWorkbook} from '../finance-statement-verify/workbook.ts';
export type StructuredQuarantineResult =
 | {state:'validated_data';method:'native-ofx-v1'|'strict-csv-matrix-v1'|'strict-workbook-matrix-v1';mime:'application/json';bytes:Uint8Array;financialMappingRequired:boolean}
 | {state:'quarantined';issue:'format_requires_sanitization'|'format_not_supported'|'legacy_workbook_requires_review'};
// Pure preparation only. This module grants no Storage access and does not claim antivirus verification.
const startsWith=(bytes:Uint8Array,signature:number[])=>signature.every((value,index)=>bytes[index]===value);
const isZip=(bytes:Uint8Array)=>[[0x50,0x4b,0x03,0x04],[0x50,0x4b,0x05,0x06],[0x50,0x4b,0x07,0x08]].some(signature=>startsWith(bytes,signature));
const isCfb=(bytes:Uint8Array)=>startsWith(bytes,[0xd0,0xcf,0x11,0xe0,0xa1,0xb1,0x1a,0xe1]);
export function validateQuarantinedData(format:string,bytes:Uint8Array,delimiter?:';'|','|'\t',sheetIndex?:number):StructuredQuarantineResult {
 if(!bytes.length||bytes.length>10*1024*1024)throw new Error('quarantine_size_limit');
 if(format==='ofx'){
  const data=readOfxStatement(bytes);
  return {state:'validated_data',method:'native-ofx-v1',mime:'application/json',bytes:new TextEncoder().encode(JSON.stringify(data)),financialMappingRequired:false};
 }
 if(format==='csv'){
  if(!delimiter)throw new Error('quarantine_csv_delimiter_required');
  if(bytes.some(byte=>byte<32&&![9,10,13].includes(byte)))throw new Error('quarantine_control_character');
  const rows=readStatementCsv(bytes,delimiter);
  if(!rows.length||rows[0].length<2||rows.some(row=>row.length>100||row.some(cell=>typeof cell!=='string'||cell.length>16384)))throw new Error('quarantine_csv_shape');
  // Text stays inert JSON. Do not export these cells verbatim as spreadsheet formulas.
  return {state:'validated_data',method:'strict-csv-matrix-v1',mime:'application/json',bytes:new TextEncoder().encode(JSON.stringify({version:1,delimiter,rows})),financialMappingRequired:true};
 }
 if(format==='xls'){
  if(!isCfb(bytes))throw new Error('quarantine_workbook_signature');
  return {state:'quarantined',issue:'legacy_workbook_requires_review'};
 }
 if(format==='xlsx'){
  if(!isZip(bytes))throw new Error('quarantine_workbook_signature');
  if(!Number.isInteger(sheetIndex)||sheetIndex!<0||sheetIndex!>99)throw new Error('quarantine_workbook_sheet_required');
  const workbook=readStatementWorkbook(bytes,sheetIndex!);
  const body={version:1,format,sheet_index:sheetIndex!,sheet_count:workbook.sheetCount,sheet_names:workbook.sheetNames,date1904:workbook.date1904,rows:workbook.matrix};
  return {state:'validated_data',method:'strict-workbook-matrix-v1',mime:'application/json',bytes:new TextEncoder().encode(JSON.stringify(body)),financialMappingRequired:true};
 }
 return {state:'quarantined',issue:['pdf','jpeg','png'].includes(format)?'format_requires_sanitization':'format_not_supported'};
}
