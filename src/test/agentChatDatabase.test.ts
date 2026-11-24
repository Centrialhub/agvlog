// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash,randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {agentActor,agentContext,agentList,agentPayload,agentSend,createAgentChatDatabase} from './helpers/agentChatDatabase';
import {chatIds as i,chatList,chatPayload,chatSend} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createAgentChatDatabase();
 const contract=JSON.parse(readFileSync('docs/qa/agent-chat-sql-contract.json','utf8')) as {functions:Array<{name:string;after:string}>;compatibleRollbackSha256:string};
 expect(createHash('sha256').update(readFileSync('docs/qa/agent-chat-compatible-rollback.sql')).digest('hex')).toBe(contract.compatibleRollbackSha256);
 const actual=await db.query<{name:string;hash:string}>("select n.nspname||'.'||p.proname as name,md5(p.prosrc) hash from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname||'.'||p.proname=any($1::text[])",[contract.functions.map(f=>f.name)]);
 expect(actual.rows.sort((a,b)=>a.name.localeCompare(b.name))).toEqual(contract.functions.map(f=>({name:f.name,hash:f.after})).sort((a,b)=>a.name.localeCompare(b.name)));
},30000);
afterAll(()=>db?.close());beforeEach(async()=>{await db.exec('begin');await agentActor(db);});afterEach(()=>db.exec('rollback'));
it('accepts the same frozen source with Linux line endings and keeps private messages out of general chat',async()=>{
 const linux=await createAgentChatDatabase(true);
 try{await linux.exec('begin');await agentActor(linux);
  await agentSend(linux,await agentPayload(linux));
  expect((await agentList(linux)).messages).toHaveLength(1);
  expect((await chatList(linux)).messages).toHaveLength(0);
 }finally{await linux.exec('rollback');await linux.close();}
},30000);
it('keeps two agent conversations separate, replies in both directions and hides them from general chat and other agents',async()=>{
 await agentSend(db,await agentPayload(db,i.operator,'Para operação'));
 await agentSend(db,await agentPayload(db,i.admin,'Para administração'));
 await chatSend(db,await chatPayload(db,i.user,i.driver,'Mensagem geral'));
 expect((await chatList(db)).messages.map(m=>m.message)).toEqual(['Mensagem geral']);
 await agentActor(db,i.operator);expect((await agentList(db)).messages.map(m=>m.message)).toEqual(['Para operação']);
 await expect(agentList(db,i.admin)).rejects.toThrow('not_authorized');
 expect((await operationRpc(db,'select id from driver_direct_messages where agent_user_id=$1',[i.admin])).rows).toEqual([]);
 await agentSend(db,await agentPayload(db,i.operator,'Resposta da operação',i.operator));
 await agentActor(db,i.admin);await agentSend(db,await agentPayload(db,i.admin,'Resposta da administração',i.admin));
 await agentActor(db);expect((await agentList(db)).messages.map(m=>m.message)).toEqual(['Resposta da operação','Para operação']);
 expect((await agentList(db,i.admin)).messages.map(m=>m.message)).toEqual(['Resposta da administração','Para administração']);
 const contacts=(await operationRpc<{r:{contacts:Array<{user_id:string;last_message:string}>}}>(db,'select list_driver_chat_agents($1,$2) r',[i.tenant,i.driver])).rows[0].r.contacts;
 expect(contacts).toEqual(expect.arrayContaining([expect.objectContaining({user_id:i.operator,last_message:'Resposta da operação'}),expect.objectContaining({user_id:i.admin,last_message:'Resposta da administração'})]));
});
it('replays the exact request once and rejects tampered agent, stale context and foreign tenant/driver identities',async()=>{
 const payload=await agentPayload(db);const first=await agentSend(db,payload);expect(await agentSend(db,payload)).toEqual(first);
 await expect(agentSend(db,{...payload,agent_user_id:i.admin})).rejects.toThrow('request_mismatch');
 await expect(agentSend(db,{...await agentPayload(db),expected_revision:'0'.repeat(32)})).rejects.toThrow('context_changed');
 await expect(agentContext(db,i.operator,i.peerDriver)).rejects.toThrow('not_authorized');
 await expect(operationRpc(db,'select get_driver_agent_chat_context($1,$2,$3)',[i.otherTenant,i.foreignDriver,i.operator])).rejects.toThrow('not_authorized');
 await agentActor(db,i.client);await expect(agentContext(db)).rejects.toThrow('not_authorized');
});
it('freezes recipients, keeps old confirmed messages recoverable when an agent is inactive and blocks new messages',async()=>{
 const payload=await agentPayload(db);await agentSend(db,payload);
 await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
 expect((await agentContext(db)).can_send).toBe(false);expect(await agentSend(db,payload)).toMatchObject({confirmed:true});
 await expect(agentSend(db,await agentPayload(db))).rejects.toThrow('recipient_unavailable');
 await db.query('update drivers set user_id=$1 where id=$2',[i.peerUser,i.driver]);
 await expect(agentList(db)).rejects.toThrow('not_authorized');
 await agentActor(db,i.peerUser);expect((await agentList(db,i.admin)).messages).toEqual([]);
});
it('paginates an agent thread without repeating rows and rejects a cursor from another agent',async()=>{
 for(let n=0;n<53;n++)await agentSend(db,await agentPayload(db,i.operator,`Mensagem ${n}`));
 const first=await agentList(db),second=await agentList(db,i.operator,i.driver,first.next_cursor);
 expect(first.messages).toHaveLength(50);expect(second.messages).toHaveLength(3);expect(new Set([...first.messages,...second.messages].map(m=>m.id)).size).toBe(53);
 await expect(agentList(db,i.admin,i.driver,first.next_cursor)).rejects.toThrow('invalid_cursor');
});
it('allows only the agent to load its operational inbox and enforces invoker/grant boundaries',async()=>{
 await agentSend(db,await agentPayload(db));
 await expect(operationRpc(db,'select list_driver_agent_inbox($1) r',[i.tenant])).rejects.toThrow('not_authorized');
 await agentActor(db,i.operator);
 const inbox=(await operationRpc<{r:{threads:Array<{driver_id:string}>}}>(db,'select list_driver_agent_inbox($1) r',[i.tenant])).rows[0].r;
 expect(inbox.threads.map(t=>t.driver_id)).toEqual([i.driver]);
 await agentActor(db,i.admin);expect((await operationRpc<{r:{threads:unknown[]}}>(db,'select list_driver_agent_inbox($1) r',[i.tenant])).rows[0].r.threads).toEqual([]);
 for(const signature of ['get_driver_agent_chat_context(uuid,uuid,uuid)','list_driver_agent_chat_messages(uuid,uuid,uuid,jsonb)','send_driver_agent_chat_message(jsonb)','list_driver_chat_agents(uuid,uuid)','list_driver_agent_inbox(uuid,jsonb)']){
  expect((await db.query<{safe:boolean}>("select not prosecdef and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') safe from pg_proc where oid=$1::regprocedure",[signature])).rows[0].safe).toBe(true);
 }
 await expect(operationRpc(db,"insert into driver_direct_messages(tenant_id,driver_id,agent_user_id,sender_id,sender_role,message) values($1,$2,$3,$4,'operator','Direto')",[i.tenant,i.driver,i.operator,i.admin])).rejects.toThrow();
});
it('supports a compatible pause without losing confirmed replay or exposing private messages through the general room',async()=>{
 const payload=await agentPayload(db);const result=await agentSend(db,payload);
 await db.exec(readFileSync('docs/qa/agent-chat-compatible-rollback.sql','utf8'));
 expect(await agentSend(db,payload)).toEqual(result);
 await expect(agentSend(db,await agentPayload(db))).rejects.toThrow('agent_chat_paused');
 expect((await agentList(db)).messages).toHaveLength(1);expect((await chatList(db)).messages).toEqual([]);
});
it('paginates the agent inbox across many drivers and rejects another agent cursor',async()=>{
 for(let n=0;n<52;n++){
  const user=randomUUID(),driver=randomUUID();
  await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,user]);
  await db.query('insert into drivers(id,tenant_id,user_id,name,active) values($1,$2,$3,$4,true)',[driver,i.tenant,user,`Motorista paginado ${n}`]);
  await agentActor(db,user);await agentSend(db,await agentPayload(db,i.operator,`Mensagem ${n}`,user,driver));
 }
 await agentActor(db,i.operator);
 const first=(await operationRpc<{r:{threads:Array<{driver_id:string}>;next_cursor:unknown}}>(db,'select list_driver_agent_inbox($1) r',[i.tenant])).rows[0].r;
 const second=(await operationRpc<{r:{threads:Array<{driver_id:string}>}}>(db,'select list_driver_agent_inbox($1,$2::jsonb) r',[i.tenant,JSON.stringify(first.next_cursor)])).rows[0].r;
 expect(first.threads).toHaveLength(50);expect(second.threads).toHaveLength(2);expect(new Set([...first.threads,...second.threads].map(t=>t.driver_id)).size).toBe(52);
 await agentActor(db,i.admin);await expect(operationRpc(db,'select list_driver_agent_inbox($1,$2::jsonb)',[i.tenant,JSON.stringify(first.next_cursor)])).rejects.toThrow('invalid_cursor');
});
