import {z} from 'zod';
import {supabase} from '@/integrations/supabase/client';
import {readBlobBytes} from '@/lib/uploadPolicy';
import {mapStatementMatrix,readStatementCsv,type StatementMapping} from '../../../supabase/functions/_shared/finance-statement-reader';
import {readOfxStatement} from '../../../supabase/functions/_shared/finance-ofx-reader';
import {originalHash,statementFileType} from '../../../supabase/functions/secure-upload/statement-original';
import {financeStatementOriginalReady,intakeFinanceStatement} from './ledgerClient';
import {statementImportStore} from './statementImportStore';
import {createStatementImportWorkflow} from './statementImportWorkflow';
import {pendingStatementSchema,type PendingStatement} from './statementImportContract';
export async function inspectStatementLayout(file:File,delimiter:string,sheet=0){
  if(!file.size||file.size>10485760)throw new Error('Selecione um extrato de até 10 MB.');
  const bytes=await readBlobBytes(file),type=statementFileType(file.name,bytes);if(!type)throw new Error('Use OFX, CSV UTF-8, XLS ou XLSX válido.');
  if(type.extension==='ofx'){const nativeOfx=readOfxStatement(bytes);return {matrix:[],sheetNames:['OFX'],nativeOfx};}
  if(type.extension==='csv')return {matrix:readStatementCsv(bytes,delimiter),sheetNames:['CSV']};
  const {readStatementWorkbook,statementWorkbookNames}=await import('../../../supabase/functions/finance-statement-verify/workbook');
  try{const result=readStatementWorkbook(bytes,sheet);return {matrix:result.matrix,sheetNames:result.sheetNames};}
  catch{return {matrix:[],sheetNames:statementWorkbookNames(bytes),preview_error:'Esta aba não pode ser lida como extrato. Selecione a aba correta ou revise o arquivo.'};}
}
export async function prepareStatementImport(file:File,context:{tenant:string;actor:string;account:string;start:string;end:string;reason:string},mapping:StatementMapping){
  if(!file.size||file.size>10485760)throw new Error('Selecione um extrato de até 10 MB.');
  const bytes=await readBlobBytes(file),type=statementFileType(file.name,bytes);if(!type)throw new Error('Use OFX, CSV UTF-8, XLS ou XLSX válido.');
  const hash=await originalHash(bytes);let matrix:unknown[][]=[],date1904=false;
  const nativeOfx=type.extension==='ofx'?readOfxStatement(bytes):null;
  if(nativeOfx){mapping={header_row:0,number_format:'decimal',date_format:'ymd',date_column:0,description_column:1,amount_column:2};}
  else if(type.extension==='csv')matrix=readStatementCsv(bytes,mapping.delimiter||'');
  else{const {readStatementWorkbook}=await import('../../../supabase/functions/finance-statement-verify/workbook');
    const source=readStatementWorkbook(bytes,mapping.sheet_index??0);matrix=source.matrix;date1904=source.date1904;}
  const parsed=nativeOfx||mapStatementMatrix(matrix,mapping,{start:context.start,end:context.end},date1904);
  if(parsed.rows.some(row=>row.posted_on<context.start||row.posted_on>context.end))throw new Error('date_outside_period');
  const pending=pendingStatementSchema.parse({version:1,tenant:context.tenant,actor:context.actor,file_name:file.name,file_size:file.size,created_at:new Date().toISOString(),
    phase:'upload',uncertain:false,verification_request:crypto.randomUUID(),command:{version:1,tenant_id:context.tenant,request_id:crypto.randomUUID(),bank_account_id:context.account,
      source_path:`${context.tenant}/imports/${hash}.${type.extension}`,file_hash:hash,file_name:file.name,currency:'BRL',parser_version:nativeOfx?'native-ofx-v1':type.extension==='csv'?'mapped-csv-v1':'mapped-workbook-v1',
      mapping,period_start:context.start,period_end:context.end,reason:context.reason,rows:parsed.rows}});
  return {pending,totals:{inflow_cents:parsed.inflow_cents,outflow_cents:parsed.outflow_cents,net_cents:parsed.net_cents}};
}
async function uploadOriginal(row:PendingStatement,file:File){
  const bytes=await readBlobBytes(file);
  if(file.size!==row.file_size||await originalHash(bytes)!==row.command.file_hash)throw new Error('Selecione o mesmo arquivo original; os dados deste pedido estão preservados.');
  const form=new FormData();form.set('tenant_id',row.tenant);form.set('bucket','finance-statements');form.set('folder','imports');form.set('kind','statement');
  form.set('file',file,row.file_name);
  const {data,error}=await supabase.functions.invoke('secure-upload',{body:form});
  if(error)throw new Error('Envio do original sem confirmação. Recupere o mesmo pedido.');
  const ack=z.object({path:z.string(),sha256:z.string(),size:z.number().int()}).parse(data);
  if(ack.path!==row.command.source_path||ack.sha256!==row.command.file_hash||ack.size!==row.file_size)throw new Error('Resposta do upload não corresponde ao arquivo original.');
}
export function statementImportWorkflow(assertContext:()=>void){
  return createStatementImportWorkflow({store:statementImportStore,assertContext,
    lock:async(name,work)=>{
      if(!navigator.locks?.request)throw new Error('Este navegador não oferece a proteção necessária para recuperar a importação entre janelas.');
      return navigator.locks.request(name,{mode:'exclusive'},work);
    },
    originalReady:row=>financeStatementOriginalReady(row.command),upload:uploadOriginal,intake:row=>intakeFinanceStatement(row.command),
    verify:async row=>{
      if(!row.receipt)throw new Error('Registro do extrato ainda não confirmado.');
      const {data,error}=await supabase.functions.invoke('finance-statement-verify',{body:{tenant_id:row.tenant,import_id:row.receipt.import_id,request_id:row.verification_request}});
      if(error)throw new Error('Conferência do original sem confirmação. O extrato registrado foi preservado; retome a conferência.');return data;
    },
  });
}
