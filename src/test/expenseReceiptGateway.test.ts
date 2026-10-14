// @vitest-environment node
import {createHash} from 'node:crypto';
import {describe,expect,it,vi} from 'vitest';
import {UNSCANNED_UPLOAD_PROVENANCE} from '../../supabase/functions/secure-upload/scan-policy';
import {expenseReceiptUpload} from '../../supabase/functions/secure-upload/expense-receipt';
const tenant='ec400000-0000-4000-8000-000000000001',actor='ec400000-0000-4000-8000-000000000002',request='ec400000-0000-4000-8000-000000000003',source='ec400000-0000-4000-8000-000000000004';
const bytes=new Uint8Array([137,80,78,71,13,10,26,10]),sha256=createHash('sha256').update(bytes).digest('hex');
function setup(uploaded=false){
 const context={tenant,actor,request,sourceType:'trip',sourceId:source,mime:'image/png',bytes,declaredHash:sha256};
 const receipt={sha256,mime:'image/png',size:8};
 const probe={version:1,tenant_id:tenant,actor_id:actor,request_id:request,source_type:'trip',source_id:source,path:tenant+'/expense-receipts/'+actor+'/'+request+'/receipt.png',uploaded,receipt,
  metadata:{version:1,tenant_id:tenant,actor_id:actor,request_id:request,source_type:'trip',source_id:source,...receipt,...UNSCANNED_UPLOAD_PROVENANCE} as Record<string,unknown>};
 const inspect=vi.fn(async()=>({data:probe as unknown,error:null as unknown})),scan=vi.fn(async()=>({available:true,clean:true})),upload=vi.fn(async()=>{probe.uploaded=true;return {error:null as unknown};});
 return {context,probe,deps:{inspect,scan,upload}};
}
describe('expense receipt gateway; no real external service',()=>{
 it('uploads once with server-scoped metadata and never overwrites',async()=>{
  const s=setup();const result=await expenseReceiptUpload(s.context,s.deps);expect(result.status).toBe(200);expect(s.deps.upload).toHaveBeenCalledWith(s.probe.path,bytes,{contentType:'image/png',upsert:false,cacheControl:'3600',metadata:s.probe.metadata});expect(s.deps.scan).not.toHaveBeenCalled();
  expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(200);expect(s.deps.upload).toHaveBeenCalledTimes(1);expect(s.deps.scan).not.toHaveBeenCalled();
 });
 it('recognizes a completed upload without invoking the scanner again',async()=>{
  const s=setup(true);expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(200);expect(s.deps.scan).not.toHaveBeenCalled();expect(s.deps.upload).not.toHaveBeenCalled();
 });
 it('rejects changed file bytes before any database, storage or scanner call',async()=>{
  const s=setup();expect((await expenseReceiptUpload({...s.context,declaredHash:'0'.repeat(64)},s.deps)).status).toBe(400);expect(s.deps.inspect).not.toHaveBeenCalled();
 });
 it('does not depend on an unavailable scanner or manufacture a positive verdict',async()=>{
  const s=setup();s.deps.scan.mockRejectedValue(new Error('Scanner must not be contacted'));
  expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(200);expect(s.deps.scan).not.toHaveBeenCalled();
  expect(s.deps.upload).toHaveBeenCalledWith(s.probe.path,bytes,expect.objectContaining({metadata:expect.objectContaining({scanned:false,scan_status:'not_performed',scan_policy:'patch2-no-scanner-v1'})}));
 });
 it('preserves a completed legacy positive object without relabeling or overwriting',async()=>{
  const s=setup(true);s.probe.metadata={...s.probe.metadata,scanned:true};delete (s.probe.metadata as Record<string,unknown>).scan_status;delete (s.probe.metadata as Record<string,unknown>).scan_policy;
  expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(200);expect(s.deps.upload).not.toHaveBeenCalled();expect(s.probe.metadata.scanned).toBe(true);
 });
 it.each([null,'false','true',0,1])('rejects forged scanned type %j rather than treating it as provenance',async value=>{
  const s=setup();s.deps.inspect.mockResolvedValue({data:{...s.probe,metadata:{...s.probe.metadata,scanned:value}},error:null});
  expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(403);expect(s.deps.upload).not.toHaveBeenCalled();
 });
 it('denies wrong tenant, actor, source, path or scanner provenance in the probe',async()=>{
  for(const edit of ['tenant_id','actor_id','source_id','path','metadata']){const s=setup();s.deps.inspect.mockResolvedValue({data:{...s.probe,[edit]:edit==='metadata'?{...s.probe.metadata,scan_policy:'client-forged'}:request},error:null});expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(403);expect(s.deps.scan).not.toHaveBeenCalled();expect(s.deps.upload).not.toHaveBeenCalled();}
 });
 it('rechecks permission between authorization inspections before saving the file',async()=>{
  const s=setup();s.deps.inspect.mockResolvedValueOnce({data:s.probe,error:null}).mockResolvedValue({data:null,error:{code:'42501'}});expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(403);expect(s.deps.upload).not.toHaveBeenCalled();
 });
 it('recovers a lost Storage response only after the exact object is verified',async()=>{
  const s=setup();s.deps.upload.mockImplementation(async()=>{s.probe.uploaded=true;return {error:{message:'Response lost'}};});expect((await expenseReceiptUpload(s.context,s.deps)).status).toBe(200);
  const missing=setup();missing.deps.upload.mockResolvedValue({error:{message:'Failure'}});expect((await expenseReceiptUpload(missing.context,missing.deps)).status).toBe(503);
 });
});
