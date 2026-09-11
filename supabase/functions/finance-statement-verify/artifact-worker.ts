import {compareStatementRows,mapStatementMatrix,StatementReadError,type StatementSourceRow} from '../_shared/finance-statement-reader.ts';
import {checkStatementBalances} from '../_shared/finance-statement-balances.ts';
import {originalHash} from '../secure-upload/statement-original.ts';
import type {StatementSourceContext} from './worker.ts';
const object=(v:unknown):Record<string,unknown>=>{if(!v||typeof v!=='object'||Array.isArray(v))throw new StatementReadError('artifact_json_invalid');return v as Record<string,unknown>;};
export async function readArtifactReport(context:StatementSourceContext,download:(path:string)=>Promise<Uint8Array>){
 const source=context.import_data,a=object(source.source_snapshot?.artifact),original=object(a.original),d=object(a.derivative);
 if(a.version!==2||a.tenant_id!==source.tenant_id||a.source_type!=='bank_account'||a.source_id!==source.bank_account_id||a.state!=='validated_data'||original.sha256!==source.file_hash
  ||d.bucket!=='upload-validated'||d.path!==source.source_path||d.mime!=='application/json'||typeof d.sha256!=='string'||!/^[a-f0-9]{64}$/.test(d.sha256)
  ||typeof d.path!=='string'||!d.path.startsWith(`${source.tenant_id}/`)||!/^[-a-f0-9]+\/[-a-f0-9]+\/validated\.json$/.test(d.path))throw new Error('finance_statement_scope_invalid');
 const bytes=await download(d.path);
 if(!bytes.length||bytes.length>20971520||bytes.length!==d.size_bytes)throw new Error('finance_statement_source_unavailable');
 const actualHash=await originalHash(bytes),verified=actualHash===d.sha256;
 const evidence={artifact_id:a.artifact_id,original_sha256:original.sha256,derivative_sha256:d.sha256,actual_derivative_hash:actualHash,derivative_hash_verified:verified,
  original_reopened:false,validation_method:d.method,hash_verified:verified,actual_hash:source.file_hash};
 if(!verified)return {outcome:'unreadable',report:{...evidence,error:'derivative_hash_mismatch'}};
 try{
  const json=object(JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(bytes)));
  let report:Record<string,unknown>,rows:StatementSourceRow[];
  if(original.format==='ofx'&&d.method==='native-ofx-v1'&&d.financial_mapping_required===false&&source.parser_version==='native-ofx-v1'){
   if(json.parser_version!=='native-ofx-v1'||json.currency!=='BRL'||!Array.isArray(json.rows)||json.rows.length>10000||!Array.isArray(json.posted_dates))throw new StatementReadError('artifact_json_invalid');
   rows=json.rows.map(value=>{
    const row=object(value);
    if(typeof row.posted_on!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(row.posted_on)||typeof row.amount_cents!=='number'||!Number.isSafeInteger(row.amount_cents)||row.amount_cents===0||Math.abs(row.amount_cents)>99999999999999||typeof row.description!=='string'||!row.raw)throw new StatementReadError('artifact_json_invalid');
    return row as unknown as StatementSourceRow;
   });
   if(rows.some(row=>row.posted_on<source.period_start||row.posted_on>source.period_end))throw new StatementReadError('date_outside_period');
   let incoming=0n,outgoing=0n;for(const row of rows){if(row.amount_cents>0)incoming+=BigInt(row.amount_cents);else outgoing-=BigInt(row.amount_cents);}
   if(json.inflow_cents!==incoming.toString()||json.outflow_cents!==outgoing.toString()||json.net_cents!==(incoming-outgoing).toString())throw new StatementReadError('artifact_totals_invalid');
   const {rows:_rows,posted_dates:_dates,...nativeEvidence}=json;
   report={inflow_cents:json.inflow_cents,outflow_cents:json.outflow_cents,net_cents:json.net_cents,native_evidence:nativeEvidence,identity_trust:'native_file_identifier'};
  }else if(original.format==='csv'&&d.method==='strict-csv-matrix-v1'&&d.financial_mapping_required===true&&source.parser_version==='mapped-csv-v1'){
   if(json.version!==1||json.delimiter!==source.mapping.delimiter||!Array.isArray(json.rows)||json.rows.some(row=>!Array.isArray(row)||row.length>100||row.some(cell=>typeof cell!=='string')))throw new StatementReadError('artifact_json_invalid');
   const parsed=mapStatementMatrix(json.rows,source.mapping,{start:source.period_start,end:source.period_end},false);rows=parsed.rows;
   report={inflow_cents:parsed.inflow_cents,outflow_cents:parsed.outflow_cents,net_cents:parsed.net_cents,balance_rows:parsed.balance_rows,balance_check:checkStatementBalances(rows,source.mapping),sheet_count:1,identity_trust:'mapped_unverified'};
  }else throw new StatementReadError('parser_format_mismatch');
  const comparison=compareStatementRows(rows,context.rows);
  return {outcome:comparison.matches?'rows_match':'rows_mismatch',report:{...evidence,...report,parsed_rows:rows.length,matched_rows:comparison.matches?rows.length:0,mismatch_rows:comparison.mismatch_rows,account_coverage_verification:'pending'}};
 }catch(error){if(!(error instanceof StatementReadError)&&!(error instanceof SyntaxError)&&!(error instanceof TypeError))throw error;return {outcome:'unreadable',report:{...evidence,error:error instanceof StatementReadError?error.message:'artifact_json_invalid'}};}
}
