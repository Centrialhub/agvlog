import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createExpenseCreationOutbox,pendingExpenseCreation} from '@/lib/financial/expenseCreationOutbox';
import {receiptPath,type ExpenseCreationCommand,type ExpenseCreationInput} from '@/lib/financial/expenseCreationCommands';
const tenant='ec500000-0000-4000-8000-000000000001',actor='ec500000-0000-4000-8000-000000000002',request='ec500000-0000-4000-8000-000000000003',source='ec500000-0000-4000-8000-000000000004';
const key='agvlog:expense-creation:v1:'+tenant+':'+actor;
const input:ExpenseCreationInput={source_type:'trip',source_id:source,expected_revision:'a'.repeat(32),fields:{category:'food',amount_cents:2500,expense_at:'2026-08-30T12:00:00Z',payment_source:'driver',reimbursable:true,no_receipt:true,no_receipt_reason:'Sem comprovante em QA'},receipt:null};
const ack=(p:ExpenseCreationCommand)=>({version:1,tenant_id:tenant,actor_id:actor,request_id:p.request_id,source_type:p.source_type,source_id:p.source_id,expense_id:source,command_id:request,driver_id:actor,status:'pending',confirmed:true,receipt_path:receiptPath(p)});
const fileInput:ExpenseCreationInput={...input,fields:{...input.fields,no_receipt:false,no_receipt_reason:null},receipt:{sha256:'b'.repeat(64),mime:'image/png',size:8}};
const receiptAck=(p:ExpenseCreationCommand,uploaded=true)=>({version:1,tenant_id:tenant,actor_id:actor,request_id:p.request_id,source_type:p.source_type,source_id:p.source_id,path:receiptPath(p),uploaded,receipt:p.receipt});
function setup(){
 const send=vi.fn(async(p:ExpenseCreationCommand):Promise<{data:unknown;error:unknown}>=>({data:ack(p),error:null}));
 const receiptStatus=vi.fn(async(p:ExpenseCreationCommand)=>receiptAck(p,false)),upload=vi.fn(async(p:ExpenseCreationCommand)=>receiptAck(p)),assertContext=vi.fn();
 const outbox=createExpenseCreationOutbox({storage:localStorage,uuid:()=>request,assertContext,changed:()=>{},lock:async(_key,work)=>work(),send,receiptStatus,upload});
 return {send,receiptStatus,upload,assertContext,outbox};
}
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
describe('expense creation outbox phase safety',()=>{
 it('persists before business transmission and clears only matching confirmation',async()=>{
  const s=setup();s.send.mockImplementation(async p=>{expect(pendingExpenseCreation(localStorage,tenant,actor)).toMatchObject({phase:'submitting',payload:p});return {data:ack(p),error:null};});
  await s.outbox.submit(tenant,actor,input);expect(localStorage.getItem(key)).toBeNull();
 });
 it('persists receipt identity before uploading without storing file bytes',async()=>{
  const s=setup();s.upload.mockImplementation(async p=>{expect(pendingExpenseCreation(localStorage,tenant,actor)).toMatchObject({phase:'upload',payload:p});expect(localStorage.getItem(key)).not.toContain('base64');return receiptAck(p);});
  await s.outbox.submit(tenant,actor,fileInput,new File(['qa'],'qa.png'));expect(s.upload).toHaveBeenCalledTimes(1);expect(s.send).toHaveBeenCalledTimes(1);
 });
 it('recognizes a completed upload after remount without the file or another upload',async()=>{
  const s=setup();s.upload.mockRejectedValueOnce(new Error('Lost upload response'));await expect(s.outbox.submit(tenant,actor,fileInput,new File(['qa'],'qa.png'))).rejects.toThrow();
  expect(s.send).not.toHaveBeenCalled();const next=setup();next.receiptStatus.mockImplementation(async p=>receiptAck(p));await next.outbox.recover(tenant,actor);
  expect(next.upload).not.toHaveBeenCalled();expect(next.send).toHaveBeenCalledTimes(1);
 });
 it('requires reselecting an incomplete file and only permits abandonment before business submission',async()=>{
  const s=setup();await expect(s.outbox.submit(tenant,actor,fileInput)).rejects.toThrow('Selecione novamente');
  expect(pendingExpenseCreation(localStorage,tenant,actor)?.phase).toBe('upload');expect(s.send).not.toHaveBeenCalled();await s.outbox.abandon(tenant,actor);expect(localStorage.getItem(key)).toBeNull();
 });
 it('does not repeat upload/probe when the business command may already be committed',async()=>{
  const s=setup();s.send.mockResolvedValueOnce({data:null,error:{message:'Lost'}});await expect(s.outbox.submit(tenant,actor,fileInput,new File(['qa'],'qa.png'))).rejects.toBeTruthy();
  const stored=pendingExpenseCreation(localStorage,tenant,actor)!.payload;s.receiptStatus.mockRejectedValue(new Error('Trip no longer available'));
  await s.outbox.recover(tenant,actor);expect(s.receiptStatus).toHaveBeenCalledTimes(1);expect(s.upload).toHaveBeenCalledTimes(1);expect(s.send.mock.calls[1][0]).toEqual(stored);
 });
 it('never discards uncertain writes, including after a later permission denial',async()=>{
  const s=setup();s.send.mockResolvedValueOnce({data:null,error:{message:'Lost'}});await expect(s.outbox.submit(tenant,actor,input)).rejects.toBeTruthy();
  const stored=localStorage.getItem(key);await expect(s.outbox.abandon(tenant,actor)).rejects.toThrow('pode ter sido registrado');
  s.send.mockResolvedValueOnce({data:null,error:{code:'42501',message:'Denied'}});await expect(s.outbox.recover(tenant,actor)).rejects.toBeTruthy();expect(localStorage.getItem(key)).toBe(stored);
 });
 it('releases definite first rejection but retains mismatched confirmation',async()=>{
  const s=setup();s.send.mockResolvedValueOnce({data:null,error:{code:'40001',message:'Changed'}});await expect(s.outbox.submit(tenant,actor,input)).rejects.toBeTruthy();expect(localStorage.getItem(key)).toBeNull();
  s.send.mockImplementationOnce(async p=>({data:{...ack(p),source_id:actor},error:null}));await expect(s.outbox.submit(tenant,actor,input)).rejects.toThrow('confirmação');
  expect(pendingExpenseCreation(localStorage,tenant,actor)?.phase).toBe('submitting');await s.outbox.recover(tenant,actor);
 });
 it('refuses incompatible storage versions or save failures before transmission',async()=>{
  const s=setup();localStorage.setItem(key.replace(':v1:',':v9:'),'{}');await expect(s.outbox.submit(tenant,actor,input)).rejects.toThrow('incompatível');localStorage.clear();
  vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});await expect(s.outbox.submit(tenant,actor,input)).rejects.toThrow('indisponível');expect(s.send).not.toHaveBeenCalled();expect(s.upload).not.toHaveBeenCalled();
 });
 it('coalesces double clicks and keeps recovery in the original scope after session change',async()=>{
  const s=setup();let release=()=>{};const hold=new Promise<void>(resolve=>{release=resolve;});s.send.mockImplementation(async p=>{await hold;s.assertContext.mockImplementation(()=>{throw new Error('Session changed');});return {data:ack(p),error:null};});
  const first=s.outbox.submit(tenant,actor,input),second=s.outbox.submit(tenant,actor,input);expect(first).toBe(second);release();await expect(first).rejects.toThrow('Session changed');
  expect(s.send).toHaveBeenCalledTimes(1);expect(pendingExpenseCreation(localStorage,tenant,actor)?.phase).toBe('submitting');expect(pendingExpenseCreation(localStorage,actor,tenant)).toBeNull();
 });
});
