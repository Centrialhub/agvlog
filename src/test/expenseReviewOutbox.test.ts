import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createExpenseReviewOutbox,pendingExpenseReview} from '@/lib/financial/expenseReviewOutbox';
import type {ExpenseReviewCommand} from '@/lib/financial/expenseReviewCommands';
const tenant='de400000-0000-4000-8000-000000000001',actor='de400000-0000-4000-8000-000000000002',request='de400000-0000-4000-8000-000000000003';
const input={expense_id:'de400000-0000-4000-8000-000000000004',expected_revision:'a'.repeat(32),action:'approve' as const,reason:'Despesa conferida'};
const key='agvlog:expense-review:v1:'+tenant+':'+actor;
const ack=(p:ExpenseReviewCommand)=>({version:1,tenant_id:p.tenant_id,actor_id:p.actor_id,request_id:p.request_id,expense_id:p.expense_id,action:p.action,status:p.action==='approve'?'approved':'rejected',confirmed:true,command_id:tenant,revision:'b'.repeat(32)});
function setup(send=vi.fn(async(p:ExpenseReviewCommand):Promise<{data:unknown;error:unknown}>=>({data:ack(p),error:null}))){
 const assertContext=vi.fn();return {send,assertContext,outbox:createExpenseReviewOutbox({storage:localStorage,uuid:()=>request,assertContext,changed:()=>{},lock:async(_key,work)=>work(),send})};
}
beforeEach(()=>localStorage.clear());
describe('expense review durable outbox',()=>{
 it('persists before transmission and clears only matching confirmation',async()=>{
  const {outbox}=setup(vi.fn(async p=>{expect(pendingExpenseReview(localStorage,tenant,actor)?.payload).toEqual(p);return {data:ack(p),error:null};}));await outbox.submit(tenant,actor,input);expect(localStorage.getItem(key)).toBeNull();
 });
 it('retains wrong acknowledgements and recovers the exact original body',async()=>{
  const {outbox,send}=setup();send.mockImplementationOnce(async p=>({data:{...ack(p),expense_id:actor},error:null}));await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('confirmação');const stored=pendingExpenseReview(localStorage,tenant,actor)!;await outbox.recover(tenant,actor);expect(send.mock.calls[1][0]).toEqual(stored.payload);expect(localStorage.getItem(key)).toBeNull();
 });
 it('retains an uncertain request even if its later replay is denied',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();const stored=localStorage.getItem(key);send.mockResolvedValueOnce({data:null,error:{code:'42501',message:'Revogado'}});await expect(outbox.recover(tenant,actor)).rejects.toBeTruthy();expect(localStorage.getItem(key)).toBe(stored);
 });
 it('allows a fresh reviewed preview after a definite first rejection',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{code:'40001',message:'expense_context_changed'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();expect(localStorage.getItem(key)).toBeNull();
 });
 it('coalesces double clicks without duplicate transmission',async()=>{
  let release=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});const {outbox,send}=setup(vi.fn(async p=>{await wait;return {data:ack(p),error:null};}));const first=outbox.submit(tenant,actor,input),second=outbox.submit(tenant,actor,input);expect(first).toBe(second);expect(send).toHaveBeenCalledTimes(1);release();await first;
 });
 it('does not overwrite an uncertain review with another decision',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();const stored=localStorage.getItem(key);await expect(outbox.submit(tenant,actor,{...input,action:'reject'})).rejects.toThrow('Recupere');expect(localStorage.getItem(key)).toBe(stored);expect(send).toHaveBeenCalledTimes(1);
 });
 it('rejects corrupt scope and unknown storage versions before transmission',async()=>{
  const {outbox,send}=setup();localStorage.setItem(key.replace(':v1:',':v2:'),'{}');await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('incompatível');localStorage.clear();localStorage.setItem(key,JSON.stringify({version:1,tenantId:actor,actorId:actor,createdAt:new Date().toISOString(),payload:{...input,version:1,tenant_id:tenant,actor_id:actor,request_id:request}}));await expect(outbox.recover(tenant,actor)).rejects.toThrow('incompatível');expect(send).not.toHaveBeenCalled();
 });
 it('keeps a committed result recoverable if the actor changes before the response arrives',async()=>{
  const {outbox,send,assertContext}=setup();send.mockImplementationOnce(async p=>{assertContext.mockImplementation(()=>{throw new Error('Sessão mudou');});return {data:ack(p),error:null};});await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('Sessão mudou');expect(pendingExpenseReview(localStorage,tenant,actor)?.payload.request_id).toBe(request);
 });
});
