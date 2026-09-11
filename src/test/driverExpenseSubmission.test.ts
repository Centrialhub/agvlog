import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createDriverExpenseSubmission} from '@/lib/driver/driverExpenseSubmission';
import {createMemoryDriverExpenseOfflineStore} from '@/lib/driver/driverExpenseOfflineStore';
import {receiptPath,type ExpenseCreationCommand,type ExpenseCreationInput} from '@/lib/financial/expenseCreationCommands';

const tenant='de100000-0000-4000-8000-000000000001',actor='de100000-0000-4000-8000-000000000002',request='de100000-0000-4000-8000-000000000003';
const trip='de100000-0000-4000-8000-000000000004',expense='de100000-0000-4000-8000-000000000005',command='de100000-0000-4000-8000-000000000006';
const input:ExpenseCreationInput={source_type:'trip',source_id:trip,expected_revision:'a'.repeat(32),receipt:null,fields:{category:'fuel',amount_cents:12345,expense_at:'2026-09-10T12:00:00Z',payment_source:'driver',reimbursable:true,no_receipt:false,no_receipt_reason:null,notes:'Abastecimento',supplier_name:'Posto QA',document_number:'123',city:'Santos',state:'SP',odometer:100,cost_center:null}};
const descriptor={sha256:'b'.repeat(64),mime:'image/png' as const,size:8};
const receiptAck=(payload:ExpenseCreationCommand,uploaded:boolean)=>({version:1,tenant_id:tenant,actor_id:actor,request_id:payload.request_id,source_type:'trip',source_id:trip,path:receiptPath(payload),uploaded,receipt:payload.receipt});
const result=(payload:ExpenseCreationCommand)=>({version:1,tenant_id:tenant,actor_id:actor,request_id:payload.request_id,source_type:'trip',source_id:trip,expense_id:expense,command_id:command,driver_id:actor,status:'pending',confirmed:true,receipt_path:receiptPath(payload)});

function setup(){
 const store=createMemoryDriverExpenseOfflineStore();let online=false;
 const send=vi.fn(async(payload:ExpenseCreationCommand):Promise<{data:ReturnType<typeof result>|null;error:{code:string;message:string}|null}>=>({data:result(payload),error:null})),upload=vi.fn(async(payload:ExpenseCreationCommand)=>receiptAck(payload,true));
 const receiptStatus=vi.fn(async(payload:ExpenseCreationCommand)=>receiptAck(payload,false));
 const outbox=createDriverExpenseSubmission({store,uuid:()=>request,now:()=>new Date('2026-09-10T12:01:00Z'),online:()=>online,changed:vi.fn(),lock:async(_key,work)=>work(),describe:async()=>descriptor,receiptStatus,upload,send});
 return {store,outbox,send,upload,receiptStatus,setOnline:(value:boolean)=>{online=value;}};
}

beforeEach(()=>vi.restoreAllMocks());
describe('driver expense durable operational outbox',()=>{
 it('stores the receipt bytes before returning an offline acknowledgement',async()=>{
  const s=setup(),file=new File([new Uint8Array([137,80,78,71,13,10,26,10])],'cupom.png',{type:'image/png'});const saved=await s.outbox.submit(tenant,actor,input,file);
  expect(saved).toMatchObject({queued:true,requestId:request,needsAttention:false});expect(s.send).not.toHaveBeenCalled();expect(s.upload).not.toHaveBeenCalled();
  const drafts=await s.store.list(tenant,actor);expect(drafts).toHaveLength(1);expect(drafts[0].receipt.blob.size).toBe(8);expect(drafts[0].payload.request_id).toBe(request);
 });
 it('replays the same request, uploads once and clears only after server confirmation',async()=>{
  const s=setup(),file=new File([new Uint8Array(8)],'cupom.png',{type:'image/png'});await s.outbox.submit(tenant,actor,input,file);s.setOnline(true);
  const replay=await s.outbox.replay(tenant,actor);expect(replay).toEqual({confirmed:1,pending:0,needsAttention:0});expect(s.send).toHaveBeenCalledTimes(1);expect(s.send.mock.calls[0][0].request_id).toBe(request);
  expect(s.upload).toHaveBeenCalledTimes(1);expect(await s.store.list(tenant,actor)).toEqual([]);
 });
 it('does not expose another actor queue and preserves a definitive rejection for attention',async()=>{
  const s=setup(),file=new File([new Uint8Array(8)],'cupom.png',{type:'image/png'});await s.outbox.submit(tenant,actor,input,file);expect(await s.store.list(tenant,'de100000-0000-4000-8000-000000000099')).toEqual([]);
  s.setOnline(true);s.send.mockResolvedValueOnce({data:null,error:{code:'40001',message:'expense_creation_context_changed'}});const replay=await s.outbox.replay(tenant,actor);
  expect(replay).toEqual({confirmed:0,pending:1,needsAttention:1});expect((await s.store.list(tenant,actor))[0]).toMatchObject({state:'needs_attention',lastError:'expense_creation_context_changed'});
 });
 it('records only a pending expense command and has no ledger writer dependency',async()=>{
  const s=setup();s.setOnline(true);const value=await s.outbox.submit(tenant,actor,input,new File([new Uint8Array(8)],'cupom.png',{type:'image/png'}));
  expect(value).toMatchObject({queued:false,confirmed:{status:'pending',confirmed:true}});expect(s.send.mock.calls[0][0].source_type).toBe('trip');
 });
 it('counts only a failed receipt upload and preserves the receipt for retry',async()=>{
  const s=setup(),file=new File([new Uint8Array(8)],'cupom.png',{type:'image/png'});s.setOnline(true);
  s.upload.mockRejectedValueOnce(new Error('upload transport interrupted'));
  await expect(s.outbox.submit(tenant,actor,input,file)).resolves.toMatchObject({queued:true,needsAttention:false});
  expect((await s.store.list(tenant,actor))[0]).toMatchObject({state:'queued',uploadFailures:1});
  await expect(s.outbox.replay(tenant,actor)).resolves.toMatchObject({confirmed:1,pending:0});
  expect(s.upload).toHaveBeenCalledTimes(2);
 });
});
