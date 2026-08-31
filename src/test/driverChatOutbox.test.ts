import {beforeEach,describe,expect,it,vi} from 'vitest';
import {createChatOutbox,pendingChat} from '@/lib/driver/chatOutbox';
import type {ChatCommand} from '@/lib/driver/chatCommands';
const tenant='dc400000-0000-4000-8000-000000000001',actor='dc400000-0000-4000-8000-000000000002',request='dc400000-0000-4000-8000-000000000003';
const input={driver_id:'dc400000-0000-4000-8000-000000000004',expected_revision:'a'.repeat(32),message:'Mensagem a recuperar'};
const key='agvlog:driver-chat:v1:'+tenant+':'+actor;
const ack=(p:ChatCommand)=>({version:1,tenant_id:p.tenant_id,actor_id:p.actor_id,driver_id:p.driver_id,request_id:p.request_id,confirmed:true,
 message:{id:tenant,tenant_id:p.tenant_id,driver_id:p.driver_id,sender_id:p.actor_id,sender_role:'driver',sender_name:'Motorista QA',message:p.message,created_at:'2026-08-30T12:00:00Z',request_id:p.request_id,conversation_user_id:actor,verified_sender:true,has_legacy_attachment:false}});
function setup(send=vi.fn(async(p:ChatCommand):Promise<{data:unknown;error:unknown}>=>({data:ack(p),error:null}))){
 const assertContext=vi.fn();return {send,assertContext,outbox:createChatOutbox({storage:localStorage,uuid:()=>request,assertContext,changed:()=>{},lock:async(_key,work)=>work(),send})};
}
beforeEach(()=>{localStorage.clear();vi.restoreAllMocks();});
describe('durable chat outbox',()=>{
 it('persists before transmission and clears only matching confirmation',async()=>{
  const {outbox}=setup(vi.fn(async p=>{expect(pendingChat(localStorage,tenant,actor)?.payload).toEqual(p);return {data:ack(p),error:null};}));await outbox.submit(tenant,actor,input);expect(localStorage.getItem(key)).toBeNull();
 });
 it('retains wrong acknowledgements and recovers the exact original body',async()=>{
  const {outbox,send}=setup();send.mockImplementationOnce(async p=>({data:{...ack(p),driver_id:actor},error:null}));await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('incompatível');const stored=pendingChat(localStorage,tenant,actor)!;await outbox.recover(tenant,actor);expect(send.mock.calls[1][0]).toEqual(stored.payload);expect(localStorage.getItem(key)).toBeNull();
 });
 it('retains an uncertain request even if its later replay is denied',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();const stored=localStorage.getItem(key);send.mockResolvedValueOnce({data:null,error:{code:'42501',message:'Revogado'}});await expect(outbox.recover(tenant,actor)).rejects.toBeTruthy();expect(localStorage.getItem(key)).toBe(stored);
 });
 it('allows a fresh reviewed context after a definite first rejection',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{code:'40001',message:'driver_chat_context_changed'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();expect(localStorage.getItem(key)).toBeNull();
 });
 it('coalesces double clicks without duplicate transmission',async()=>{
  let release=()=>{};const wait=new Promise<void>(resolve=>{release=resolve;});const {outbox,send}=setup(vi.fn(async p=>{await wait;return {data:ack(p),error:null};}));const first=outbox.submit(tenant,actor,input),second=outbox.submit(tenant,actor,input);expect(first).toBe(second);expect(send).toHaveBeenCalledTimes(1);release();await first;
 });
 it('does not overwrite an uncertain message with another message',async()=>{
  const {outbox,send}=setup();send.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}});await expect(outbox.submit(tenant,actor,input)).rejects.toBeTruthy();const stored=localStorage.getItem(key);await expect(outbox.submit(tenant,actor,{...input,message:'Outro texto'})).rejects.toThrow('Recupere');expect(localStorage.getItem(key)).toBe(stored);expect(send).toHaveBeenCalledTimes(1);
 });
 it('rejects corrupt scope and unknown storage versions before transmission',async()=>{
  const {outbox,send}=setup();localStorage.setItem(key.replace(':v1:',':v2:'),'{}');await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('incompatível');localStorage.clear();localStorage.setItem(key,JSON.stringify({version:1,tenantId:actor,actorId:actor,payload:{...input,version:1,tenant_id:tenant,actor_id:actor,request_id:request}}));await expect(outbox.recover(tenant,actor)).rejects.toThrow('incompatível');expect(send).not.toHaveBeenCalled();
 });
 it('keeps a committed result recoverable if the actor changes before the response arrives',async()=>{
  const {outbox,send,assertContext}=setup();send.mockImplementationOnce(async p=>{assertContext.mockImplementation(()=>{throw new Error('Sessão mudou');});return {data:ack(p),error:null};});await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('Sessão mudou');expect(pendingChat(localStorage,tenant,actor)?.payload.request_id).toBe(request);
 });
 it('does not transmit when durable storage is unavailable',async()=>{
  const {outbox,send}=setup();vi.spyOn(Storage.prototype,'setItem').mockImplementation(()=>{throw new Error('Quota');});await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('indisponível');expect(send).not.toHaveBeenCalled();
 });
 it('preserves exact replay if removal from storage fails after confirmation',async()=>{
  const {outbox}=setup();vi.spyOn(Storage.prototype,'removeItem').mockImplementation(()=>{throw new Error('Storage unavailable');});await expect(outbox.submit(tenant,actor,input)).resolves.toMatchObject({confirmed:true});expect(pendingChat(localStorage,tenant,actor)?.payload.request_id).toBe(request);
 });
 it('rejects an acknowledgement for different message content even with a matching request',async()=>{
  const {outbox}=setup(vi.fn(async p=>({data:{...ack(p),message:{...ack(p).message,message:'Outra mensagem'}},error:null})));await expect(outbox.submit(tenant,actor,input)).rejects.toThrow('confirmação compatível');expect(pendingChat(localStorage,tenant,actor)).not.toBeNull();
 });
});
