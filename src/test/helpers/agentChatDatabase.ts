import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {chatIds,createDriverChatDatabase,chatActor} from './driverChatDatabase';
import {operationRpc} from './operationOutcomeDatabase';
import {randomUUID} from 'node:crypto';
export const agentChatMigration='20261124194200_driver_agent_chat_threads.sql';
export async function installAgentChat(db:PGlite){
 // Exact captured live chat sources; the fixture's original historical MFA helpers differ.
 const functions=JSON.parse(readFileSync('docs/qa/agent-chat-previous-functions.json','utf8')) as Array<{definition:string}>;
 for(const source of functions)await db.exec(source.definition);
 // Partial fixture only: active-tenant membership guard. CI executes the real production guard on PostgreSQL 17.
 await db.exec(`create schema if not exists private;
 create or replace function private.is_request_tenant_member(uuid) returns boolean language sql stable as
 $$select $1=nullif(current_setting('test.agent_tenant',true),'')::uuid and exists(select 1 from public.tenant_memberships where tenant_id=$1 and user_id=auth.uid() and active)$$;`);
 await db.query("select set_config('test.agent_tenant',$1,false)",[chatIds.tenant]);
 await db.exec(readFileSync('supabase/migrations/'+agentChatMigration,'utf8'));
}
export async function createAgentChatDatabase(){const db=await createDriverChatDatabase();await installAgentChat(db);return db;}
export const agentActor=async(db:PGlite,actor=chatIds.user,tenant=chatIds.tenant)=>{
 await chatActor(db,actor);await db.query("select set_config('test.agent_tenant',$1,false)",[tenant]);
};
export async function agentContext(db:PGlite,agent=chatIds.operator,driver=chatIds.driver){
 return (await operationRpc<{r:{revision:string;agent_user_id:string;can_send:boolean;agent_name:string}}>(db,'select get_driver_agent_chat_context($1,$2,$3) r',[chatIds.tenant,driver,agent])).rows[0].r;
}
export async function agentPayload(db:PGlite,agent=chatIds.operator,message='Mensagem direta QA',actor=chatIds.user,driver=chatIds.driver){
 return {version:1,tenant_id:chatIds.tenant,actor_id:actor,driver_id:driver,agent_user_id:agent,request_id:randomUUID(),expected_revision:(await agentContext(db,agent,driver)).revision,message};
}
export async function agentSend(db:PGlite,payload:unknown){
 return (await operationRpc<{r:{confirmed:boolean;message:{id:string;message:string;agent_user_id:string};request_id:string}}>(db,'select send_driver_agent_chat_message($1::jsonb) r',[JSON.stringify(payload)])).rows[0].r;
}
export async function agentList(db:PGlite,agent=chatIds.operator,driver=chatIds.driver,before:unknown=null){
 return (await operationRpc<{r:{messages:Array<{id:string;message:string;agent_user_id:string;created_at:string}>;next_cursor:unknown}}>(db,'select list_driver_agent_chat_messages($1,$2,$3,$4::jsonb) r',[chatIds.tenant,driver,agent,JSON.stringify(before)])).rows[0].r;
}
