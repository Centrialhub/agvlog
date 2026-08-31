import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createFinancialOutbox,pendingFinancialCommand} from '@/lib/financial/receivableFinancialOutbox';
import type {FinancialCommand} from '@/lib/financial/receivableCommands';
const tenant='cf400000-0000-4000-8000-000000000001',actor='cf400000-0000-4000-8000-000000000002',request='cf400000-0000-4000-8000-000000000003';
const input={receivable_id:'cf400000-0000-4000-8000-000000000004',expected_revision:'a'.repeat(32),action:'receive' as const,amount_cents:1000,effective_date:'2026-08-30',bank_account_id:tenant,method:'pix' as const,reason:'Conferência financeira'};
const key=`agvlog:receivable-financial:v1:${tenant}:${actor}`;
const ack=(p:FinancialCommand)=>({version:1,tenant_id:p.tenant_id,actor_id:p.actor_id,request_id:p.request_id,receivable_id:p.receivable_id,action:p.action,confirmed:true,command_id:tenant,payment_id:request,reversal_id:null,bank_transaction_id:actor,revision:'b'.repeat(32),received_cents:1000,open_cents:23000,report_id:null,invoice_id:null});
function setup(send=vi.fn(async(p:FinancialCommand):Promise<{data:unknown;error:unknown}>=>({data:ack(p),error:null}))){
 const assertContext=vi.fn(),changed=vi.fn();const outbox=createFinancialOutbox({storage:localStorage,uuid:()=>request,assertContext,changed,lock:async(_key,work)=>work(),send});return {outbox,send,assertContext};
}
beforeEach(()=>localStorage.clear());
describe('durable receivable-financial browser outbox',()=>{
 it('persists before transmission and clears only after a matching acknowledgement',async()=>{
  const send=vi.fn(async(p:FinancialCommand)=>{expect(pendingFinancialCommand(localStorage,tenant,actor)?.payload).toEqual(p);return {data:ack(p),error:null};});
  const {outbox}=setup(send);await outbox.submit(tenant,actor,input);expect(pendingFinancialCommand(localStorage,tenant,actor)).toBeNull();expect(send).toHaveBeenCalledTimes(1);
 });
 it('keeps a mismatched acknowledgement uncertain and recovers the exact original body',async()=>{
  const {outbox,send}=setup();send.mockImplementationOnce(async p=>({data:{...ack(p),receivable_id:actor},error:null}));
  await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('confirmação');const pending=pendingFinancialCommand(localStorage,tenant,actor)!;
  await outbox.recover(tenant,actor);expect(send.mock.calls[1][0]).toEqual(pending.payload);expect(localStorage.getItem(key)).toBeNull();
 });
 it('removes a first definitely rejected command but preserves a previously uncertain request on rejection',async()=>{
  const {outbox,send}=setup();send.mockResolvedValue({data:null,error:{code:'40001',message:'closing_action_context_changed'}});
  await expect(outbox.submit(tenant,actor,input)).rejects.toMatchObject({code:'40001'});expect(localStorage.getItem(key)).toBeNull();
  send.mockResolvedValueOnce({data:null,error:{message:'Conexão perdida'}});await expect(outbox.submit(tenant,actor,input)).rejects.toMatchObject({message:'Conexão perdida'});
  const stored=localStorage.getItem(key);await expect(outbox.recover(tenant,actor)).rejects.toMatchObject({code:'40001'});expect(localStorage.getItem(key)).toBe(stored);
 });
 it('coalesces overlapping retries into a single transmission',async()=>{
  let release:()=>void=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});const {outbox,send}=setup(vi.fn(async p=>{await wait;return {data:ack(p),error:null};}));
  const first=outbox.submit(tenant,actor,input),second=outbox.submit(tenant,actor,input);expect(first).toBe(second);expect(send).toHaveBeenCalledTimes(1);release();await first;
 });
 it('refuses another action while a response is uncertain, without replacing the persisted request',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{message:'Conexão perdida'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();
  const stored=localStorage.getItem(key);await expect(outbox.submit(tenant,actor,{...input,amount_cents:2000})).rejects.toThrow('Recupere');expect(send).toHaveBeenCalledTimes(1);expect(localStorage.getItem(key)).toBe(stored);
 });
 it('rejects unknown storage versions and corrupt scope before transmission',async()=>{
  const {outbox,send}=setup();const future=key.replace(':v1:',':v2:');localStorage.setItem(future,'{}');await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('incompatível');localStorage.removeItem(future);
  localStorage.setItem(key,JSON.stringify({version:1,tenantId:actor,actorId:actor,createdAt:new Date().toISOString(),payload:{...input,version:1,tenant_id:tenant,actor_id:actor,request_id:request}}));
  await expect(outbox.recover(tenant,actor)).rejects.toThrow('incompatível');expect(send).not.toHaveBeenCalled();
 });
 it('keeps an acknowledgement for recovery if the authenticated context changes before receipt',async()=>{
  const {outbox,send,assertContext}=setup();send.mockImplementationOnce(async p=>{assertContext.mockImplementation(()=>{throw new Error('Sessão mudou');});return {data:ack(p),error:null};});
  await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('Sessão mudou');expect(pendingFinancialCommand(localStorage,tenant,actor)?.payload.request_id).toBe(request);
 });
});
