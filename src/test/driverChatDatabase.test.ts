// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {chatActor,chatContext,chatIds as i,chatList,chatPayload,chatSend,createDriverChatDatabase,driverChatSql,legacyChatSend} from './helpers/driverChatDatabase';
import {operationRpc} from './helpers/operationOutcomeDatabase';
import {ownerStatement} from './helpers/deliveryAttemptDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createDriverChatDatabase();});afterAll(()=>db?.close());
beforeEach(async()=>{await db.exec('begin');await chatActor(db);});afterEach(()=>db.exec('rollback'));
const count=async()=>(await db.query<{n:number}>('select count(*)::int n from driver_direct_messages')).rows[0].n;
describe('authenticated bidirectional chat',{timeout:15000},()=>{
 it('derives both sender identities and makes the reply visible to the driver',async()=>{
  const driver=await chatSend(db,await chatPayload(db));expect(driver.message).toMatchObject({sender_id:i.user,sender_role:'driver',sender_name:'Motorista QA',conversation_user_id:i.user,verified_sender:true});
  await chatActor(db,i.operator);const reply=await chatSend(db,await chatPayload(db,i.operator,i.driver,'Resposta da operação'));expect(reply.message).toMatchObject({sender_id:i.operator,sender_role:'operator',sender_name:'Operação QA'});
  await chatActor(db);expect((await chatList(db)).messages).toHaveLength(2);expect(await count()).toBe(2);
 });
 it('returns the exact same acknowledgement after a lost reply and rejects request-key reuse',async()=>{
  const p=await chatPayload(db),result=await chatSend(db,p);expect(await chatSend(db,p)).toEqual(result);await expect(chatSend(db,{...p,message:'Outro corpo'})).rejects.toThrow('request_mismatch');expect(await count()).toBe(1);
 });
 it('does not accept sender names, roles or attachments supplied in the payload',async()=>{
  const p=await chatPayload(db);for(const fields of [{sender_role:'owner'},{sender_name:'Outra pessoa'},{attachment_url:'https://untrusted.invalid/a'}])await expect(chatSend(db,{...p,...fields})).rejects.toThrow('invalid_payload');expect(await count()).toBe(0);
 });
 it('blocks legacy insert and new message rewrites and deletion',async()=>{
  await expect(legacyChatSend(db)).rejects.toThrow('permission denied');const m=(await chatSend(db,await chatPayload(db))).message;
  await expect(ownerStatement(db,'update driver_direct_messages set message=$1 where id=$2',['Alterado',m.id])).rejects.toThrow('immutable');
  await expect(ownerStatement(db,'delete from driver_direct_messages where id=$1',[m.id])).rejects.toThrow('immutable');expect(await count()).toBe(1);
 });
 it('denies another driver, another tenant and a forged actor',async()=>{
  const p=await chatPayload(db);await expect(chatContext(db,i.peerDriver)).rejects.toThrow('not_authorized');await expect(chatSend(db,{...p,actor_id:i.operator})).rejects.toThrow('not_authorized');
  await expect(chatSend(db,{...p,tenant_id:i.otherTenant,driver_id:i.foreignDriver})).rejects.toThrow('not_authorized');
  await chatActor(db,i.operator);await expect(chatContext(db,i.foreignDriver)).rejects.toThrow('not_authorized');
 });
 it('revocation stops reads, writes, replay and direct table access despite an active driver profile',async()=>{
  const p=await chatPayload(db);await chatSend(db,p);await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.user]);
  await expect(chatList(db)).rejects.toThrow('not_authorized');await expect(chatSend(db,p)).rejects.toThrow('not_authorized');expect((await operationRpc(db,'select * from driver_direct_messages')).rows).toEqual([]);
 });
 it('requires AAL2 for privileged membership on context, read and send',async()=>{
  await chatActor(db,i.admin);await expect(chatContext(db)).rejects.toThrow('mfa_required');await expect(chatList(db)).rejects.toThrow('mfa_required');
  await chatActor(db,i.admin,'aal2');const p=await chatPayload(db,i.admin);expect((await chatSend(db,p)).message.sender_role).toBe('admin');
  await chatActor(db,i.admin);await expect(chatSend(db,p)).rejects.toThrow('mfa_required');expect((await operationRpc(db,'select * from driver_direct_messages')).rows).toEqual([]);
 });
 it('does not treat a client membership or anonymous session as a chat identity',async()=>{
  await chatActor(db,i.client);await expect(chatContext(db)).rejects.toThrow('not_authorized');await db.exec("select set_config('request.jwt.claim.sub','',false)");await expect(chatContext(db)).rejects.toThrow('not_authorized');
 });
 it('rejects a stale recipient binding and does not reveal old messages to a replacement user',async()=>{
  await chatActor(db,i.operator);const p=await chatPayload(db,i.operator);await chatSend(db,p);const next=await chatPayload(db,i.operator);
  await db.query('update drivers set user_id=$1 where id=$2',[i.peerUser,i.driver]);await expect(chatSend(db,next)).rejects.toThrow('context_changed');expect(await chatSend(db,p)).toMatchObject({confirmed:true});
  await chatActor(db,i.peerUser);expect((await chatList(db)).messages).toEqual([]);expect((await operationRpc(db,'select * from driver_direct_messages')).rows).toEqual([]);
 });
 it('keeps operator history but refuses sending to inactive or unlinked recipients',async()=>{
  await chatSend(db,await chatPayload(db));await chatActor(db,i.operator);await db.query('update drivers set active=false where id=$1',[i.driver]);
  expect((await chatContext(db)).can_send).toBe(false);expect((await chatList(db)).messages).toHaveLength(1);await expect(chatSend(db,await chatPayload(db,i.operator))).rejects.toThrow('recipient_unavailable');
 });
 it('validates nonempty bounded message content and the exact context revision',async()=>{
  const p=await chatPayload(db);for(const message of ['', '  ', 'x'.repeat(4001),42,null])await expect(chatSend(db,{...p,message})).rejects.toThrow('invalid_message');
  await expect(chatSend(db,{...p,expected_revision:'x'})).rejects.toThrow('context_changed');expect(await count()).toBe(0);
 });
 it('refuses new operation messages when the recipient membership was revoked, but preserves confirmation and history',async()=>{
  await chatActor(db,i.operator);const p=await chatPayload(db,i.operator),ack=await chatSend(db,p);
  await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.user]);
  expect((await chatContext(db)).can_send).toBe(false);
  await expect(chatSend(db,{...p,request_id:i.peerDriver})).rejects.toThrow('recipient_unavailable');
  expect(await chatSend(db,p)).toEqual(ack);expect((await chatList(db)).messages).toHaveLength(1);
 });
 it('does not treat a linked client membership as a driver recipient',async()=>{
  await chatActor(db,i.operator);await db.query("update tenant_memberships set role='client' where tenant_id=$1 and user_id=$2",[i.tenant,i.user]);
  expect((await chatContext(db)).can_send).toBe(false);await expect(chatSend(db,await chatPayload(db,i.operator))).rejects.toThrow('recipient_unavailable');expect(await count()).toBe(0);
 });
 it('pages the newest messages with a stable tie-breaker and a scoped cursor',async()=>{
  for(let n=0;n<51;n++)await chatSend(db,await chatPayload(db,i.user,i.driver,'Mensagem '+n));const first=await chatList(db),second=await chatList(db,i.driver,first.next_cursor);
  expect(first.messages).toHaveLength(50);expect(second.messages).toHaveLength(1);expect(new Set([...first.messages,...second.messages].map(m=>m.id)).size).toBe(51);
  await chatActor(db,i.operator);await expect(chatList(db,i.peerDriver,first.next_cursor)).rejects.toThrow('invalid_cursor');
 });
 it('rolls back a late insert failure and retries the same durable command',async()=>{
  const p=await chatPayload(db);await db.exec("create function qa_chat_failure() returns trigger language plpgsql as $$begin raise exception 'QA late chat failure';end;$$;create trigger z_qa_chat_failure after insert on driver_direct_messages for each row execute function qa_chat_failure();");
  await expect(chatSend(db,p)).rejects.toThrow('QA late chat failure');expect(await count()).toBe(0);await db.exec('drop trigger z_qa_chat_failure on driver_direct_messages');await chatSend(db,p);expect(await count()).toBe(1);
 });
 it('uses invoker public wrappers and private authenticated implementations without anonymous/service grants',async()=>{
  for(const fn of ['get_driver_chat_context(uuid,uuid)','list_driver_chat_messages(uuid,uuid,jsonb)','send_driver_chat_message(jsonb)']){
   expect((await db.query<{definer:boolean;anon:boolean;service:boolean}>('select prosecdef definer,has_function_privilege(\'anon\',oid,\'execute\') anon,has_function_privilege(\'service_role\',oid,\'execute\') service from pg_proc where oid=$1::regprocedure',[fn])).rows[0]).toEqual({definer:false,anon:false,service:false});
  }
 });
});
describe('legacy preservation',()=>{
 it('does not rewrite or delete legacy rows, including mismatched tenant bindings',async()=>{
  const legacy=await createDriverChatDatabase(false);try{
   await legacy.exec('begin');await chatActor(legacy,i.operator);await legacyChatSend(legacy,{role:'operator'});await legacyChatSend(legacy,{role:'operator',driver:i.foreignDriver});await legacy.exec('commit');
   const before=(await legacy.query('select id,sender_name,message,created_at from driver_direct_messages order by id')).rows;await legacy.exec(driverChatSql());
   expect((await legacy.query('select id,sender_name,message,created_at from driver_direct_messages order by id')).rows).toEqual(before);
   await legacy.exec('begin');await chatActor(legacy);expect((await chatList(legacy)).messages).toEqual([]);await chatActor(legacy,i.operator);expect((await chatList(legacy)).messages[0].verified_sender).toBe(false);await legacy.exec('rollback');
  }finally{await legacy.close();}
 });
});
