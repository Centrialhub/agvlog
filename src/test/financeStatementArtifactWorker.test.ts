import {describe,it,expect,vi} from 'vitest';
import {verifyStatementSource,type StatementSourceContext} from '../../supabase/functions/finance-statement-verify/worker';
import {validateQuarantinedData} from '../../supabase/functions/secure-upload/quarantine-validation';
import {originalHash} from '../../supabase/functions/secure-upload/statement-original';
import {ofxFile} from './helpers/financeOfxFixture';
async function setup(){
 const tenant=crypto.randomUUID(),account=crypto.randomUUID(),request=crypto.randomUUID(),artifact=crypto.randomUUID(),importId=crypto.randomUUID();
 const original=new TextEncoder().encode(ofxFile()),derived=validateQuarantinedData('ofx',original);
 if(derived.state!=='validated_data')throw new Error('fixture');
 const parsed=JSON.parse(new TextDecoder().decode(derived.bytes)),hash=await originalHash(original),dh=await originalHash(derived.bytes),path=`${tenant}/${request}/validated.json`;
 const context:StatementSourceContext={revision:'r',rows:parsed.rows,import_data:{id:importId,tenant_id:tenant,bank_account_id:account,source_path:path,file_hash:hash,parser_version:'native-ofx-v1',mapping:{header_row:0,date_column:0,description_column:1,amount_column:2,date_format:'ymd',number_format:'decimal'},period_start:'1900-01-01',period_end:'9999-12-31',source_snapshot:{artifact:{version:2,artifact_id:artifact,tenant_id:tenant,source_type:'bank_account',source_id:account,state:'validated_data',original:{sha256:hash,size_bytes:original.length,format:'ofx'},derivative:{bucket:'upload-validated',path,sha256:dh,size_bytes:derived.bytes.length,mime:'application/json',method:'native-ofx-v1',financial_mapping_required:false}}}}};
 const deps={inspect:async()=>context,download:vi.fn(),downloadArtifact:vi.fn(async()=>derived.bytes),workbook:vi.fn(),authorize:async()=>true,record:vi.fn(async()=>({confirmed:true}))};
 return {context,deps,input:{tenant,actor:crypto.randomUUID(),importId,request:crypto.randomUUID()}};
}
describe('statement artifact verification',()=>{
 it('recomputes rows from the real OFX derivative without downloading original',async()=>{
  const s=await setup();await verifyStatementSource(s.input,s.deps);
  expect(s.deps.download).not.toHaveBeenCalled();expect(s.deps.workbook).not.toHaveBeenCalled();
  expect(s.deps.record).toHaveBeenCalledWith(expect.objectContaining({reader_version:'statement-artifact-v2',outcome:'rows_match',report:expect.objectContaining({original_reopened:false,derivative_hash_verified:true,original_sha256:s.context.import_data.file_hash,account_coverage_verification:'pending'})}));
 });
 it('does not accept changed stored JSON even if it remains parseable',async()=>{
  const s=await setup(),bytes=await s.deps.downloadArtifact();bytes[0]=32;
  await verifyStatementSource(s.input,s.deps);expect(s.deps.record).toHaveBeenCalledWith(expect.objectContaining({outcome:'unreadable',report:expect.objectContaining({derivative_hash_verified:false})}));
 });
 it('preserves row mismatch and refuses revoked permission before recording',async()=>{
  const s=await setup();s.context.rows[0]={...s.context.rows[0],amount_cents:-100};await verifyStatementSource(s.input,s.deps);
  expect(s.deps.record).toHaveBeenCalledWith(expect.objectContaining({outcome:'rows_mismatch'}));
  s.deps.record.mockClear();s.deps.authorize=async()=>false;await expect(verifyStatementSource(s.input,s.deps)).rejects.toThrow('finance_access_denied');expect(s.deps.record).not.toHaveBeenCalled();
 });
 it('rejects another account before reading any file',async()=>{
  const s=await setup();s.context.import_data.bank_account_id=crypto.randomUUID();await expect(verifyStatementSource(s.input,s.deps)).rejects.toThrow('scope_invalid');expect(s.deps.downloadArtifact).not.toHaveBeenCalled();
 });
});
