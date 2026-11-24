import {beforeEach,expect,it,vi} from 'vitest';
import {createChatOutbox,pendingAgentChatScopes,pendingChat} from '@/lib/driver/chatOutbox';
import type {ChatCommand} from '@/lib/driver/chatCommands';
const tenant='dc400000-0000-4000-8000-000000000001',actor='dc400000-0000-4000-8000-000000000002',driver='dc400000-0000-4000-8000-000000000003';
const first='dc400000-0000-4000-8000-000000000004',second='dc400000-0000-4000-8000-000000000005';
function ack(p:ChatCommand){return {version:1,tenant_id:tenant,actor_id:actor,driver_id:driver,agent_user_id:p.agent_user_id,request_id:p.request_id,confirmed:true,
 message:{id:p.request_id,tenant_id:tenant,driver_id:driver,agent_user_id:p.agent_user_id,sender_id:actor,sender_role:'driver',sender_name:'QA',message:p.message,created_at:'2026-11-13T18:00:00Z',
 request_id:p.request_id,conversation_user_id:actor,verified_sender:true,has_legacy_attachment:false}};}
function setup(agent:string,send=vi.fn(async(p:ChatCommand):Promise<{data:unknown;error:unknown}>=>({data:ack(p),error:null}))){
 const scope={driverId:driver,agentId:agent};const outbox=createChatOutbox({storage:localStorage,scope,uuid:()=>crypto.randomUUID(),assertContext:()=>{},changed:()=>{},lock:async(_key,fn)=>fn(),send});
 const input={driver_id:driver,agent_user_id:agent,expected_revision:'a'.repeat(32),message:'Mensagem '+agent};return {outbox,input,send,scope};
}
beforeEach(()=>localStorage.clear());
it('keeps an uncertain message for one agent while another agent sends normally, then replays exactly the original request',async()=>{
 const a=setup(first),b=setup(second);a.send.mockResolvedValueOnce({data:null,error:{message:'Resposta perdida'}});
 await expect(a.outbox.submit(tenant,actor,a.input)).rejects.toBeTruthy();
 const before=pendingChat(localStorage,tenant,actor,a.scope)!.payload;
 await expect(b.outbox.submit(tenant,actor,b.input)).resolves.toMatchObject({confirmed:true,agent_user_id:second});
 expect(pendingAgentChatScopes(localStorage,tenant,actor)).toEqual([a.scope]);expect(pendingChat(localStorage,tenant,actor,b.scope)).toBeNull();
 expect(pendingChat(localStorage,tenant,actor)).toBeNull(); // General-room readers leave private pending payloads intact.
 const reopened=setup(first);await expect(reopened.outbox.recover(tenant,actor)).resolves.toMatchObject({request_id:before.request_id,agent_user_id:first});
 expect(reopened.send.mock.calls[0][0]).toEqual(before);expect(pendingAgentChatScopes(localStorage,tenant,actor)).toEqual([]);
});
it('does not clear or reuse a pending message when another agent acknowledgement arrives',async()=>{
 const a=setup(first);a.send.mockImplementationOnce(async p=>({data:ack({...p,agent_user_id:second}),error:null}));
 await expect(a.outbox.submit(tenant,actor,a.input)).rejects.toThrow();expect(pendingChat(localStorage,tenant,actor,a.scope)).not.toBeNull();
 expect(pendingAgentChatScopes(localStorage,tenant,second)).toEqual([]);expect(pendingAgentChatScopes(localStorage,second,actor)).toEqual([]);
 const b=setup(second);await expect(b.outbox.submit(tenant,actor,{...a.input})).rejects.toThrow('incompatível');expect(b.send).not.toHaveBeenCalled();
});
