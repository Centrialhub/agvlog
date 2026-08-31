import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createOperationOutcomeOutbox,pendingOperationOutcomes} from '@/lib/loads/operationOutcomeOutbox';
import {isOperationOutcomePayload,type OperationOutcomePayload} from '@/lib/loads/operationDocumentOutcome';
const tenant='20000000-0000-4000-8000-000000000001',actor='10000000-0000-4000-8000-000000000001',request='a0000000-0000-4000-8000-000000000001';
const payload=():OperationOutcomePayload=>({tenant_id:tenant,load_id:'70000000-0000-4000-8000-000000000001',document_id:'90000000-0000-4000-8000-000000000001',stop_id:'82000000-0000-4000-8000-000000000001',revision:'a'.repeat(64),outcome:'delivered',reason:'Confirmado pela operação',receiver_name:'Recebedor QA',occurred_at:'2026-08-30T12:00:00Z'});
const result=()=>({request_id:request,tenant_id:tenant,load_id:payload().load_id,document_id:payload().document_id,stop_id:payload().stop_id,outcome:'delivered',event_id:request,history_id:request,pod_id:request,proof_pending:true,stop_status:'arrived',trip_completed:false});
const scope=()=>payload().load_id+':'+payload().document_id;
const send=vi.fn();const context=vi.fn();
function controller(storage=localStorage){return createOperationOutcomeOutbox({storage,uuid:()=>request,changed:()=>{},assertContext:context,lock:async(_key,work)=>work(),send});}
beforeEach(()=>{localStorage.clear();vi.resetAllMocks();send.mockResolvedValue({data:result(),error:null});});
describe('operation outcome durable confirmation',()=>{
 it('persists before transport and clears only matching acknowledgement',async()=>{
  send.mockImplementation(async()=>{expect(pendingOperationOutcomes(localStorage,tenant,actor)).toHaveLength(1);return {data:result(),error:null};});
  await controller().submit(tenant,actor,payload());expect(localStorage.length).toBe(0);
 });
 it('remounts and replays the frozen request without permitting an uncertain overwrite',async()=>{
  send.mockResolvedValueOnce({data:{},error:null});const body=payload();await expect(controller().submit(tenant,actor,body)).rejects.toThrow(/não confirmou/);
  const sent=send.mock.calls[0][0];body.reason='Alterado depois';await expect(controller().submit(tenant,actor,body)).rejects.toThrow(/sem confirmação/);
  await controller().recover(tenant,actor,scope());expect(send.mock.calls[1][0]).toEqual(sent);expect(localStorage.length).toBe(0);
 });
 it.each(['document_id','load_id','stop_id','request_id','event_id','history_id','pod_id'])('retains uncertainty on invalid %s acknowledgement',async(field)=>{
  send.mockResolvedValue({data:{...result(),[field]:'invalid'},error:null});await expect(controller().submit(tenant,actor,payload())).rejects.toThrow(/não confirmou/);expect(localStorage.length).toBe(1);
 });
 it('requires manual proof to remain pending in a delivery acknowledgement',async()=>{
  send.mockResolvedValue({data:{...result(),proof_pending:false},error:null});await expect(controller().submit(tenant,actor,payload())).rejects.toThrow();expect(localStorage.length).toBe(1);
 });
 it('clears first proven rollback but retains prior uncertainty through a later rejection',async()=>{
  send.mockResolvedValueOnce({data:null,error:{code:'40001',message:'changed'}});await expect(controller().submit(tenant,actor,payload())).rejects.toMatchObject({code:'40001'});expect(localStorage.length).toBe(0);
  send.mockResolvedValueOnce({data:{},error:null});await expect(controller().submit(tenant,actor,payload())).rejects.toThrow();
  send.mockResolvedValueOnce({data:null,error:{code:'42501'}});await expect(controller().recover(tenant,actor,scope())).rejects.toMatchObject({code:'42501'});expect(localStorage.length).toBe(1);
 });
 it('separates recovery by actor and tenant',async()=>{
  send.mockResolvedValue({data:{},error:null});await expect(controller().submit(tenant,actor,payload())).rejects.toThrow();
  expect(pendingOperationOutcomes(localStorage,tenant,'another')).toHaveLength(0);expect(pendingOperationOutcomes(localStorage,'another',actor)).toHaveLength(0);
 });
 it('does not send when durable storage is unavailable',async()=>{
  const storage={getItem:()=>null,setItem:()=>{throw Error('denied');}} as unknown as Storage;
  await expect(controller(storage).submit(tenant,actor,payload())).rejects.toThrow(/recuperação local/);expect(send).not.toHaveBeenCalled();
 });
 it('rejects missing receiver and ambiguous time without persisting',async()=>{
  expect(isOperationOutcomePayload({...payload(),receiver_name:''})).toBe(false);expect(isOperationOutcomePayload({...payload(),occurred_at:'2026-08-30T12:00:00'})).toBe(false);
  await expect(controller().submit(tenant,actor,{...payload(),reason:''})).rejects.toThrow(/válida/);expect(send).not.toHaveBeenCalled();
 });
});

const previous='a1000000-0000-4000-8000-000000000009';
const correction=():OperationOutcomePayload=>({...payload(),correction_of:previous,returned_items:{}});
const correctionResult=()=>({...result(),correction_of:previous,correction_id:request,financial_review_required:false,settlement_id:null,settlement_status:null});
describe('versioned correction recovery',()=>{
 it('retains the request during a deliberate writer containment instead of permitting a new correction',async()=>{
  send.mockResolvedValue({data:null,error:{code:'55000',message:'Temporariamente suspenso'}});
  await expect(controller().submit(tenant,actor,correction())).rejects.toMatchObject({code:'55000'});
  expect(pendingOperationOutcomes(localStorage,tenant,actor)[0]).toMatchObject({version:2,payload:correction()});
  await expect(controller().submit(tenant,actor,correction())).rejects.toThrow(/sem confirmação/);expect(send).toHaveBeenCalledTimes(1);
 });
 it('freezes the v2 payload, including returned quantities, and replays exactly after remount',async()=>{
  const body={...correction(),outcome:'partial_delivery' as const,returned_items:{'91000000-0000-4000-8000-000000000001':0.5}};
  send.mockResolvedValueOnce({data:{},error:null});await expect(controller().submit(tenant,actor,body)).rejects.toThrow(/não confirmou/);
  const pending=pendingOperationOutcomes(localStorage,tenant,actor)[0];expect(pending.version).toBe(2);
  const sent=structuredClone(send.mock.calls[0][0]);body.returned_items['91000000-0000-4000-8000-000000000001']=0.9;body.reason='Editado depois';
  send.mockResolvedValueOnce({data:{...correctionResult(),outcome:'partial_delivery'},error:null});await controller().recover(tenant,actor,scope());
  expect(send.mock.calls[1][0]).toEqual(sent);expect(localStorage.length).toBe(0);
 });
 it.each([
  {correction_of:request},{correction_id:undefined},{correction_id:'invalid'},{history_id:previous},
  {financial_review_required:undefined},{settlement_status:'paid'},
  {financial_review_required:true,settlement_id:'invalid',settlement_status:'paid'},
  {financial_review_required:true,settlement_id:request,settlement_status:'unknown'},
 ])('retains the exact correction on a malformed acknowledgement %j',async(change)=>{
  send.mockResolvedValue({data:{...correctionResult(),...change},error:null});await expect(controller().submit(tenant,actor,correction())).rejects.toThrow(/não confirmou/);
  expect(pendingOperationOutcomes(localStorage,tenant,actor)[0]).toMatchObject({version:2,payload:correction()});
 });
 it('accepts a matching acknowledgement with a settlement requiring review',async()=>{
  send.mockResolvedValue({data:{...correctionResult(),financial_review_required:true,settlement_id:request,settlement_status:'paid'},error:null});
  await controller().submit(tenant,actor,correction());expect(localStorage.length).toBe(0);
 });
 it.each([
  {version:1}, {version:'2'}, {payload:{...correction(),correction_of:'invalid'}}, {version:2,payload:payload()},
 ])('does not migrate or send corrupted or mismatched stored schemas %j',async(change)=>{
  send.mockResolvedValue({data:{},error:null});await expect(controller().submit(tenant,actor,correction())).rejects.toThrow();
  const key=localStorage.key(0)!;const stored=JSON.parse(localStorage.getItem(key)!);localStorage.setItem(key,JSON.stringify({...stored,...change}));send.mockClear();
  expect(()=>pendingOperationOutcomes(localStorage,tenant,actor)).toThrow(/recuperação local/);
  await expect(controller().recover(tenant,actor,scope())).rejects.toThrow(/recuperação local/);expect(send).not.toHaveBeenCalled();expect(localStorage.length).toBe(1);
 });
 it('keeps an uncertain correction isolated when actor or tenant changes',async()=>{
  send.mockResolvedValue({data:{},error:null});await expect(controller().submit(tenant,actor,correction())).rejects.toThrow();send.mockClear();
  await expect(controller().recover(tenant,previous,scope())).rejects.toThrow(/válida/);
  await expect(controller().recover(previous,actor,scope())).rejects.toThrow(/válida/);expect(send).not.toHaveBeenCalled();
  expect(pendingOperationOutcomes(localStorage,tenant,actor)).toHaveLength(1);
 });
 it('does not erase the receipt if the session changes while the response is in flight',async()=>{
  context.mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{}).mockImplementationOnce(()=>{throw new Error('context changed');});
  send.mockResolvedValue({data:correctionResult(),error:null});await expect(controller().submit(tenant,actor,correction())).rejects.toThrow('context changed');
  expect(localStorage.length).toBe(1);context.mockReset();await controller().recover(tenant,actor,scope());expect(localStorage.length).toBe(0);
 });
 it('does not accept a correction acknowledgement for an ordinary confirmation',async()=>{
  send.mockResolvedValue({data:correctionResult(),error:null});await expect(controller().submit(tenant,actor,payload())).rejects.toThrow(/não confirmou/);expect(localStorage.length).toBe(1);
 });
});
