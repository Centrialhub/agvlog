import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installDriverChatFixture,driverChatSql} from '../src/test/helpers/driverChatDatabase.ts';
import {operationIds as existing} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runDriverChatNative({query,session,finish,waitForMarker,contested,literal:q}){
 const adapter={exec:query,query:async(sql,params=[])=>{const statement=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])).replace(/;\s*$/,'');return {rows:JSON.parse(await query("with qa_result as ("+statement+") select coalesce(json_agg(qa_result),'[]') from qa_result;"))};}};
 const i={tenant:existing.tenant,driver:randomUUID(),user:randomUUID(),replacement:randomUUID(),operator:randomUUID(),admin:randomUUID()};
 const watched=['loads','dispatch_trips','dispatch_stops','operational_events','proof_of_delivery','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','bank_transactions'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(watched.map(async table=>[table,await query("select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'[]')) from public."+table+' r;')])));
 const initial=await snapshot();await installDriverChatFixture(adapter);
 await query('insert into drivers(id,tenant_id,user_id,name,active) values('+[i.driver,i.tenant,i.user,'Motorista chat nativo'].map(q).join(',')+',true);'+
  'insert into tenant_memberships(tenant_id,user_id,role,active) values '+[[i.user,'driver'],[i.replacement,'driver'],[i.operator,'operator'],[i.admin,'admin']].map(([id,role])=>'('+[i.tenant,id,role].map(q).join(',')+',true)').join(',')+';'+
  'insert into profiles(id,full_name) values('+q(i.operator)+",'Operação chat nativo'),("+q(i.admin)+",'Admin chat nativo');");
 const api=(actor,aal='aal1')=>'set request.jwt.claim.sub='+q(actor)+';set request.jwt.claims='+q(JSON.stringify({aal}))+';set role authenticated;';
 const context=async(actor=i.user,aal='aal1')=>JSON.parse(await query(api(actor,aal)+'select get_driver_chat_context('+q(i.tenant)+','+q(i.driver)+');'));
 const payload=async(actor=i.user)=>({version:1,tenant_id:i.tenant,actor_id:actor,driver_id:i.driver,request_id:randomUUID(),expected_revision:(await context(actor)).revision,message:'Mensagem nativa '+randomUUID()});
 const call=(p,aal='aal1')=>api(p.actor_id,aal)+'select send_driver_chat_message('+q(JSON.stringify(p))+'::jsonb);';
 const list=async(actor=i.user)=>JSON.parse(await query(api(actor)+'select list_driver_chat_messages('+q(i.tenant)+','+q(i.driver)+',null);'));
 const count=()=>query('select count(*) from driver_direct_messages;');
 const held=async(winner,loser)=>{const h=session('chat-holder');h.send('begin;'+winner+"select '__CHAT_HELD__';");await waitForMarker(h,'__CHAT_HELD__');try{await assert.rejects(()=>query(loser),/40001.*driver_chat_concurrent_change/);}finally{await finish(h,'commit;');}};
 const tests=[
  ['chat migration preserves operational and financial data and exposes only invoker wrappers',async()=>{
   const sql=driverChatSql();await query('begin;'+sql+'commit;');console.log('Driver chat candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   for(const fn of ['get_driver_chat_context(uuid,uuid)','list_driver_chat_messages(uuid,uuid,jsonb)','send_driver_chat_message(jsonb)'])
    assert.equal(await query("select not prosecdef and has_function_privilege('authenticated',oid,'execute') and not has_function_privilege('anon',oid,'execute') and not has_function_privilege('service_role',oid,'execute') from pg_proc where oid="+q(fn)+'::regprocedure;'),'t');
   assert.equal(await query("select has_table_privilege('authenticated','driver_direct_messages','insert');"),'f');assert.deepEqual(await snapshot(),initial);
  }],
  ['identical concurrent chat commands serialize and return one canonical message',async()=>{
   const p=await payload(),before=Number(await count());await contested(call(p),call(p),{driver:false});assert.equal(Number(await count()),before+1);
   assert.deepEqual(JSON.parse(await query(call(p))),JSON.parse(await query(call(p))));assert.equal(await query('select count(*) from driver_direct_messages where client_request_id='+q(p.request_id)+';'),'1');
  }],
  ['different simultaneous driver and operation messages both commit without lost writes',async()=>{
   const first=await payload(),second=await payload(i.operator),before=Number(await count()),h=session('chat-distinct-holder');h.send('begin;'+call(first)+"select '__CHAT_FIRST_WRITTEN__';");await waitForMarker(h,'__CHAT_FIRST_WRITTEN__');
   try{assert.equal(JSON.parse(await query(call(second))).confirmed,true);assert.equal(Number(await count()),before+1);}finally{await finish(h,'commit;');}
   assert.equal(Number(await count()),before+2);assert.ok((await list()).messages.some(m=>m.request_id===second.request_id));
  }],
  ['actor revocation while a chat request waits for its key denies the eventual write',async()=>{
   const p=await payload(),before=await count(),lock="select pg_advisory_xact_lock(hashtext('driver-chat-message'),hashtext("+q(i.tenant+':'+i.user+':'+p.request_id)+'))';
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:'update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)});assert.match(result.error,/42501.*driver_chat_not_authorized/);}
   finally{await query('update tenant_memberships set active=true where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)+';');}assert.equal(await count(),before);
  }],
  ['recipient revocation cannot race an operation message through a stale context',async()=>{
   const p=await payload(i.operator),before=await count();
   try{await held('update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)+';',call(p));await assert.rejects(()=>query(call(p)),/23514.*driver_chat_recipient_unavailable/);}
   finally{await query('update tenant_memberships set active=true where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)+';');}assert.equal(await count(),before);
  }],
  ['recipient reassignment rejects stale sends and never exposes the former conversation',async()=>{
   const p=await payload(i.operator),before=await count();await held('update drivers set user_id='+q(i.replacement)+' where id='+q(i.driver)+';',call(p));
   await assert.rejects(()=>query(call(p)),/40001.*driver_chat_context_changed/);assert.equal(await count(),before);assert.deepEqual((await list(i.replacement)).messages,[]);
   await assert.rejects(()=>list(i.user),/42501.*driver_chat_not_authorized/);const newMessage=await payload(i.operator);await query(call(newMessage));assert.equal((await list(i.replacement)).messages.length,1);
  }],
  ['native privileged chat access requires MFA and denies forged direct writes',async()=>{
   await assert.rejects(()=>context(i.admin),/42501.*driver_chat_mfa_required/);const c=await context(i.admin,'aal2'),p={...(await payload(i.operator)),actor_id:i.admin,expected_revision:c.revision};
   assert.equal(JSON.parse(await query(call(p,'aal2'))).message.sender_role,'admin');await assert.rejects(()=>query(call(p)),/42501.*driver_chat_mfa_required/);
   await assert.rejects(()=>query(api(i.operator)+"insert into driver_direct_messages(tenant_id,driver_id,sender_id,sender_role,message) values("+[i.tenant,i.driver,i.operator,'owner','Forjado'].map(q).join(',')+');'),/42501.*permission denied/);
  }],
  ['a late native insert failure rolls back fully and chat leaves financial and operational records unchanged',async()=>{
   const p=await payload(i.operator),before=await count();await query("create function qa_chat_fail() returns trigger language plpgsql as $$begin raise exception 'QA late chat failure';end;$$;create trigger z_qa_chat_fail after insert on driver_direct_messages for each row execute function qa_chat_fail();");
   try{await assert.rejects(()=>query(call(p)),/QA late chat failure/);}finally{await query('drop trigger z_qa_chat_fail on driver_direct_messages;drop function qa_chat_fail();');}
   assert.equal(await count(),before);await query(call(p));assert.equal(Number(await count()),Number(before)+1);assert.deepEqual(await snapshot(),initial);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
