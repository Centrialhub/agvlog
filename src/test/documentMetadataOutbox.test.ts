import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createMetadataOutbox,pendingMetadata} from '@/lib/loads/documentMetadataOutbox';
import {metadataError,isMetadataResult,isMetadataPayload,type MetadataPayload} from '@/lib/loads/documentMetadata';
const id=(n:number)=>`11000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
const tenant=id(1),actor=id(2),request=id(3),load=id(4),doc=id(5);
const payload=():MetadataPayload=>({tenant_id:tenant,load_id:load,reason:'Conferência de pagamento QA',items:[{document_id:doc,attempt_id:null,revision:'a'.repeat(64),changes:{payment_method:'pix'}}]});
const result=()=>({request_id:request,tenant_id:tenant,actor_id:actor,load_id:load,status:'confirmed',document_count:1,
 delivery_outcomes_preserved:true,financial_values_preserved:true,items:[{document_id:doc,attempt_id:null,audit_id:id(6),revision:'b'.repeat(64),changed:true,
 fields:{rec_canhoto:false,payment_method:'pix',oco_01:'',oco_02:'',resp_oco:''}}]});
const deps=()=>({storage:localStorage,uuid:()=>request,changed:vi.fn(),assertContext:vi.fn(),
 lock:async<T>(_key:string,work:()=>Promise<T>)=>work(),send:vi.fn(async()=>({data:result() as unknown,error:null as unknown}))});
beforeEach(()=>localStorage.clear());
describe('versioned document metadata outbox',()=>{
 it('does not claim rollback when a conflict is returned while recovering an uncertain commit',()=>{
  const message=metadataError({code:'40001',message:'document_metadata_concurrent_change'});
  expect(message).toContain('pedido pendente');expect(message).not.toContain('Nenhuma conferência deste lote foi salva');
 });
 it('persists before transport and acknowledges only the exact actor/batch',async()=>{
  const d=deps();d.send.mockImplementationOnce(async()=>{expect(pendingMetadata(localStorage,tenant,actor)[0]).toMatchObject({requestId:request,payload:payload()});return {data:result(),error:null};});
  await createMetadataOutbox(d).submit(tenant,actor,payload());expect(localStorage.length).toBe(0);
 });
 it('recovers the identical body after reconstructing the client',async()=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));await expect(createMetadataOutbox(d).submit(tenant,actor,payload())).rejects.toThrow('Offline');
  await createMetadataOutbox(d).recover(tenant,actor,load);expect(d.send.mock.calls[1]).toEqual(d.send.mock.calls[0]);expect(localStorage.length).toBe(0);
 });
 it.each(['22023','23514','40001','40P01','55P03','42501'])('drops a definitive first SQL rejection %s',async code=>{
  const d=deps();d.send.mockResolvedValueOnce({data:null,error:{code,message:'Rejected'}});
  await expect(createMetadataOutbox(d).submit(tenant,actor,payload())).rejects.toMatchObject({code});expect(localStorage.length).toBe(0);
 });
 it.each(['22023','23514','40001','42501','55000','PGRST202'])('retains an uncertain request despite recovery rejection %s',async code=>{
  const d=deps();const api=createMetadataOutbox(d);d.send.mockRejectedValueOnce(new Error('Offline'));
  await expect(api.submit(tenant,actor,payload())).rejects.toThrow();d.send.mockResolvedValueOnce({data:null,error:{code,message:'Rejected'}});
  await expect(api.recover(tenant,actor,load)).rejects.toMatchObject({code});expect(localStorage.length).toBe(1);
 });
 it.each(['actor_id','request_id','tenant_id','load_id'])('retains a mismatched %s acknowledgement',async key=>{
  const d=deps();d.send.mockResolvedValueOnce({data:{...result(),[key]:id(99)},error:null});
  await expect(createMetadataOutbox(d).submit(tenant,actor,payload())).rejects.toThrow('O servidor não confirmou');expect(localStorage.length).toBe(1);
 });
 it('rejects incomplete, different-attempt, mismatched-field and unaudited acknowledgements',()=>{
  const original=result();for(const patch of [{attempt_id:id(99)},{audit_id:null},{fields:{...original.items[0].fields,payment_method:'boleto'}},{document_id:id(99)}]){
   expect(isMetadataResult({...original,items:[{...original.items[0],...patch}]},payload(),actor,request)).toBe(false);
  }
  expect(isMetadataResult({...original,items:[]},payload(),actor,request)).toBe(false);
 });
 it('keeps corrupt and future-version envelopes, blocking new submissions',async()=>{
  const key=`agvlog:document-metadata:v2:${tenant}:${actor}:${load}`;localStorage.setItem(key,'{"version":2}');
  const d=deps();await expect(createMetadataOutbox(d).submit(tenant,actor,payload())).rejects.toThrow('incompatível');expect(d.send).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
  localStorage.clear();localStorage.setItem(key.replace(':v2:',':v1:'),'broken');expect(()=>pendingMetadata(localStorage,tenant,actor)).toThrow('incompatível');expect(localStorage.length).toBe(1);
 });
 it('never loads or recovers another session envelope',async()=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));const api=createMetadataOutbox(d);await expect(api.submit(tenant,actor,payload())).rejects.toThrow();
  expect(pendingMetadata(localStorage,tenant,id(99))).toEqual([]);expect(pendingMetadata(localStorage,id(99),actor)).toEqual([]);
  await expect(api.recover(tenant,id(99),load)).rejects.toThrow();expect(d.send).toHaveBeenCalledTimes(1);
 });
 it('refuses another batch while a request is uncertain',async()=>{
  const d=deps();d.send.mockRejectedValueOnce(new Error('Offline'));const api=createMetadataOutbox(d);await expect(api.submit(tenant,actor,payload())).rejects.toThrow();
  await expect(api.submit(tenant,actor,payload())).rejects.toThrow('Há conferência sem confirmação');expect(d.send).toHaveBeenCalledTimes(1);
 });
 it('keeps the envelope when actor context changes during transport',async()=>{
  const d=deps();d.send.mockImplementationOnce(async()=>{d.assertContext.mockImplementation(()=>{throw new Error('Session changed');});return {data:result(),error:null};});
  await expect(createMetadataOutbox(d).submit(tenant,actor,payload())).rejects.toThrow('Session changed');expect(localStorage.length).toBe(1);
 });
 it('refuses storage failures before sending and forbidden result/date patches',async()=>{
  const d=deps();const set=vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});
  try{await expect(createMetadataOutbox(d).submit(tenant,actor,payload())).rejects.toThrow('indisponível');expect(d.send).not.toHaveBeenCalled();}finally{set.mockRestore();}
  expect(isMetadataPayload({...payload(),items:[{...payload().items[0],changes:{delivery_at:'2026-08-30'}}]})).toBe(false);
  expect(isMetadataPayload({...payload(),items:[...payload().items,...payload().items]})).toBe(false);
 });
});
