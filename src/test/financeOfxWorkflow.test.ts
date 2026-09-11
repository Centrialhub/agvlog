// @vitest-environment node
import {describe,expect,it,vi} from 'vitest';
import {ofxFile} from './helpers/financeOfxFixture';
import {inspectStatementLayout,prepareStatementImport} from '@/lib/financial/statementImportClient';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
import {preserveStatementOriginal} from '../../supabase/functions/secure-upload/statement-original';
vi.mock('@/integrations/supabase/client',()=>({supabase:{}}));
const mapping={header_row:0,number_format:'br' as const,date_format:'dmy' as const,date_column:0,description_column:1,amount_column:2};
describe('native OFX through original retention and server verification',()=>{
 it.each([false,true])('re-reads every original row and native metadata, empty=%s',async empty=>{
  const file=new File([empty?ofxFile(''):ofxFile()],'banco.ofx'),tenant=crypto.randomUUID(),actor=crypto.randomUUID(),account=crypto.randomUUID(),importId=crypto.randomUUID();
  const layout=await inspectStatementLayout(file,';');expect(layout.nativeOfx?.account.account_id).toBe('000123-4');
  const {pending}=await prepareStatementImport(file,{tenant,actor,account,start:'2026-09-01',end:'2026-09-30',reason:'Conferência do extrato OFX'},mapping);
  expect(pending.command.parser_version).toBe('native-ofx-v1');expect(pending.command.rows).toHaveLength(empty?0:1);
  const bytes=new Uint8Array(await file.arrayBuffer()),upload=vi.fn().mockResolvedValue({error:null});
  const original=await preserveStatementOriginal(tenant,file.name,bytes,{upload,download:async()=>null});expect(original.path).toBe(pending.command.source_path);expect(original.content_type).toBe('application/x-ofx');
  const context:StatementSourceContext={revision:'revision',import_data:{...pending.command,id:importId},rows:pending.command.rows};
  const record=vi.fn().mockResolvedValue({confirmed:true}),workbook=vi.fn();
  await verifyStatementSource({tenant,actor,importId,request:pending.verification_request},{inspect:async()=>context,download:async()=>bytes,workbook,authorize:async()=>true,record});
  expect(workbook).not.toHaveBeenCalled();expect(record).toHaveBeenCalledWith(expect.objectContaining({outcome:'rows_match',report:expect.objectContaining({matched_rows:empty?0:1,identity_trust:'native_file_identifier',account_coverage_verification:'pending',native_evidence:expect.objectContaining({account:expect.objectContaining({account_id:'000123-4'}),opening_balance:null})})}));
  if(!empty){context.rows[0]={...context.rows[0],amount_cents:-40000};await verifyStatementSource({tenant,actor,importId,request:crypto.randomUUID()},{inspect:async()=>context,download:async()=>bytes,workbook,authorize:async()=>true,record});
   expect(record).toHaveBeenLastCalledWith(expect.objectContaining({outcome:'rows_mismatch'}));}
 });
});
