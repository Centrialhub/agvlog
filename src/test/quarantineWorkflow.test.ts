import {describe,it,expect,vi} from 'vitest';
import {quarantineUpload,quarantineSha256,type QuarantineDependencies} from '../../supabase/functions/secure-upload/quarantine-workflow';
const tenant='11111111-1111-4111-8111-111111111111',actor='22222222-2222-4222-8222-222222222222',request='33333333-3333-4333-8333-333333333333',artifact='44444444-4444-4444-8444-444444444444',ticket='55555555-5555-4555-8555-555555555555';
async function setup(format='csv',text='data;valor\n2026-09-10;10,00'){
 const bytes=new TextEncoder().encode(text),hash=await quarantineSha256(bytes);
 const input={tenant,actor,request,sourceType:'bank_account',sourceId:tenant,format,mime:'text/csv',bytes,delimiter:';' as const};
 const dto={version:2,tenant_id:tenant,actor_id:actor,request_id:request,artifact_id:artifact,source_type:'bank_account',source_id:tenant,state:'quarantined',usable:false,derivative:null,issues:[],original:{sha256:hash,size_bytes:bytes.length,format,received:false}};
 const put=vi.fn<QuarantineDependencies['put']>(async()=>{}),finalize=vi.fn();
 const deps:QuarantineDependencies={caller:vi.fn(async()=>({data:dto,error:null})),put,
  service:vi.fn(async(name,args)=>{
   if(name==='prepare_finance_upload_artifact')return {data:{version:2,artifact_id:artifact,ticket,original_bucket:'upload-quarantine',original_path:`${tenant}/${request}/original`,derived_bucket:'upload-validated',derived_prefix:`${tenant}/${request}/validated`,result:dto},error:null};
   finalize(args);const p=args._payload as Record<string,unknown>;
   return {data:{...dto,...p,usable:['validated_data','sanitized_derivative'].includes(String(p.state)),original:{...dto.original,received:true}},error:null};
  })};
 return {input,dto,deps,put,finalize};
}
describe('quarantine workflow',()=>{
 it('stores original first and publishes only inert CSV JSON with its separate hash',async()=>{
  const s=await setup();await quarantineUpload(s.input,s.deps);
  expect(s.put.mock.calls).toHaveLength(2);
  expect(s.put.mock.calls[0][0]).toBe('upload-quarantine');
  expect(s.put.mock.calls[1][0]).toBe('upload-validated');
  expect(s.finalize).toHaveBeenCalledWith(expect.objectContaining({_payload:expect.objectContaining({state:'validated_data',method:'strict-csv-matrix-v1',derivative:expect.objectContaining({financial_mapping_required:true})})}));
 });
 it('retains PDF without usable derivative or fake AV claim',async()=>{
  const s=await setup('pdf','%PDF-1.7');const result=await quarantineUpload(s.input,s.deps);
  expect(s.put).toHaveBeenCalledTimes(1);expect(result.state).toBe('quarantined');expect(result.derivative).toBeNull();expect(result.scanned).toBeUndefined();
 });
 it('malformed CSV records rejection after preserving original',async()=>{
  const s=await setup('csv','a;b\n"unterminated');await quarantineUpload(s.input,s.deps);
  expect(s.put).toHaveBeenCalledTimes(1);expect(s.finalize).toHaveBeenCalledWith({_payload:expect.objectContaining({state:'rejected',derivative:null})});
 });
 it('does not finalize when storage fails',async()=>{
  const s=await setup();s.put.mockRejectedValue(new Error('offline'));
  await expect(quarantineUpload(s.input,s.deps)).rejects.toThrow('offline');expect(s.finalize).not.toHaveBeenCalled();
 });
 it('replays a finalized quarantine without replacing its original',async()=>{
  const s=await setup('pdf');s.dto.original.received=true;
  await quarantineUpload(s.input,s.deps);expect(s.put).not.toHaveBeenCalled();expect(s.finalize).not.toHaveBeenCalled();
 });
 it('rejects another actor response before any storage write',async()=>{
  const s=await setup();s.dto.actor_id=tenant;
  await expect(quarantineUpload(s.input,s.deps)).rejects.toThrow('identity_mismatch');expect(s.put).not.toHaveBeenCalled();
 });
});

it('publishes a successful image only under its derived path and preserves processing failure in quarantine',async()=>{
 const s=await setup('jpeg');s.deps.image=async()=>({state:'sanitized_derivative',method:'jpeg-png-reencode-v1',mime:'image/jpeg',bytes:new Uint8Array([1,2,3])});
 await quarantineUpload(s.input,s.deps);
 expect(s.put.mock.calls[1][1]).toBe(`${tenant}/${request}/validated.jpg`);
 expect(s.finalize).toHaveBeenCalledWith({_payload:expect.objectContaining({state:'sanitized_derivative',method:'jpeg-png-reencode-v1',derivative:expect.objectContaining({financial_mapping_required:false,mime:'image/jpeg'})})});
 const failed=await setup('png');failed.deps.image=async()=>{throw new Error('image_processing_budget');};
 const result=await quarantineUpload(failed.input,failed.deps);expect(result.state).toBe('quarantined');expect(result.usable).toBe(false);expect(failed.put).toHaveBeenCalledTimes(1);expect(result.issues).toEqual(['image_processing_budget']);
});