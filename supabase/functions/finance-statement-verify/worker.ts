import {compareStatementRows,mapStatementMatrix,readStatementCsv,StatementReadError,type StatementMapping} from '../_shared/finance-statement-reader.ts';
import {originalHash} from '../secure-upload/statement-original.ts';
import {checkStatementBalances} from '../_shared/finance-statement-balances.ts';
import {readOfxStatement} from '../_shared/finance-ofx-reader.ts';
export interface StatementSourceContext {
  revision:string;import_data:{id:string;tenant_id:string;source_path:string;file_hash:string;parser_version:string;mapping:StatementMapping;period_start:string;period_end:string};
  rows:Record<string,unknown>[];
}
export async function verifyStatementSource(input:{tenant:string;actor:string;importId:string;request:string},deps:{
  inspect:()=>Promise<StatementSourceContext>;
  download:(path:string)=>Promise<Uint8Array>;
  workbook:(bytes:Uint8Array,sheet:number)=>Promise<{matrix:unknown[][];date1904:boolean;sheetCount:number}>;
  authorize:()=>Promise<boolean>;
  record:(payload:Record<string,unknown>)=>Promise<unknown>;
}) {
  const context=await deps.inspect(),source=context.import_data;
  if(source.tenant_id!==input.tenant||source.id!==input.importId||!source.source_path.startsWith(`${input.tenant}/imports/${source.file_hash}.`)
    ||!Array.isArray(context.rows)||context.rows.length>10000)throw new Error('finance_statement_scope_invalid');
  const bytes=await deps.download(source.source_path);
  if(!bytes.length||bytes.length>10485760)throw new Error('finance_statement_source_unavailable');
  const actualHash=await originalHash(bytes);
  let outcome='unreadable';let report:Record<string,unknown>={hash_verified:actualHash===source.file_hash,actual_hash:actualHash,error:'source_hash_mismatch'};
  if(actualHash===source.file_hash){
    try{
      if(source.source_path.endsWith('.ofx')){
        if(source.parser_version!=='native-ofx-v1')throw new StatementReadError('parser_format_mismatch');
        const parsed=readOfxStatement(bytes),comparison=compareStatementRows(parsed.rows,context.rows);
        if(parsed.rows.some(row=>row.posted_on<source.period_start||row.posted_on>source.period_end))throw new StatementReadError('date_outside_period');
        outcome=comparison.matches?'rows_match':'rows_mismatch';
        const {rows:_rows,posted_dates:_dates,...nativeEvidence}=parsed;
        report={hash_verified:true,actual_hash:actualHash,parsed_rows:parsed.rows.length,matched_rows:comparison.matches?parsed.rows.length:0,
          mismatch_rows:comparison.mismatch_rows,inflow_cents:parsed.inflow_cents,outflow_cents:parsed.outflow_cents,net_cents:parsed.net_cents,
          native_evidence:nativeEvidence,identity_trust:'native_file_identifier',account_coverage_verification:'pending'};
      }else{
      let matrix:unknown[][],date1904=false,sheetCount=1;
      const csv=source.source_path.endsWith('.csv');
      if(source.parser_version!==(csv?'mapped-csv-v1':'mapped-workbook-v1'))throw new StatementReadError('parser_format_mismatch');
      if(csv)matrix=readStatementCsv(bytes,source.mapping.delimiter||'');
      else{const sheet=source.mapping.sheet_index??0;if(!Number.isInteger(sheet)||sheet<0)throw new StatementReadError('invalid_sheet');
        const workbook=await deps.workbook(bytes,sheet);matrix=workbook.matrix;date1904=workbook.date1904;sheetCount=workbook.sheetCount;}
      const parsed=mapStatementMatrix(matrix,source.mapping,{start:source.period_start,end:source.period_end},date1904);
      const comparison=compareStatementRows(parsed.rows,context.rows);
      outcome=comparison.matches?'rows_match':'rows_mismatch';
      report={hash_verified:true,actual_hash:actualHash,parsed_rows:parsed.rows.length,matched_rows:comparison.matches?parsed.rows.length:0,
        mismatch_rows:comparison.mismatch_rows,inflow_cents:parsed.inflow_cents,outflow_cents:parsed.outflow_cents,net_cents:parsed.net_cents,
        balance_rows:parsed.balance_rows,balance_check:checkStatementBalances(parsed.rows,source.mapping),sheet_count:sheetCount,identity_trust:'mapped_unverified',account_coverage_verification:'pending'};
      }
    }catch(error){if(!(error instanceof StatementReadError))throw error;report={hash_verified:true,actual_hash:actualHash,error:error.message};}
  }
  if(!await deps.authorize())throw new Error('finance_access_denied');
  return deps.record({tenant_id:input.tenant,actor_id:input.actor,request_id:input.request,import_id:input.importId,
    reader_version:'statement-source-v1',source_revision:context.revision,file_hash:source.file_hash,outcome,report});
}
