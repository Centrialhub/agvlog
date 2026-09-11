import {readOfxStatement} from '../_shared/finance-ofx-reader.ts';
import {readStatementCsv} from '../_shared/finance-statement-reader.ts';
export type StructuredQuarantineResult =
 | {state:'validated_data';method:'native-ofx-v1'|'strict-csv-matrix-v1';mime:'application/json';bytes:Uint8Array;financialMappingRequired:boolean}
 | {state:'quarantined';issue:'format_requires_sanitization'|'format_not_supported'};
// Pure preparation only. This module grants no Storage access and does not claim antivirus verification.
export function validateQuarantinedData(format:string,bytes:Uint8Array,delimiter?:';'|','|'\t'):StructuredQuarantineResult {
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
 return {state:'quarantined',issue:['pdf','xlsx','xls','jpeg','png'].includes(format)?'format_requires_sanitization':'format_not_supported'};
}
