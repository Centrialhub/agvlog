import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {installEventChatFixture,eventChatSql} from '../src/test/helpers/eventChatDatabase.ts';
import {operationIds as existing} from '../src/test/helpers/operationOutcomeDatabase.ts';
export async function runEventChatNative({query,session,finish,waitForMarker,contested,literal:q}){
 const adapter={exec:query,query:async(sql,params=[])=>{const statement=sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])).replace(/;\s*$/,'');return {rows:JSON.parse(await query("with qa_result as ("+statement+") select coalesce(json_agg(qa_result),'[]') from qa_result;"))};}};
 const i={tenant:existing.tenant,event:randomUUID(),driver:randomUUID(),peerDriver:randomUUID(),user:randomUUID(),peerUser:randomUUID(),replacement:randomUUID(),operator:randomUUID(),trip:randomUUID(),stop:randomUUID()};
 const watched=['loads','dispatch_trips','dispatch_stops','operational_events','proof_of_delivery','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','bank_transactions'];
 const snapshot=async()=>Object.fromEntries(await Promise.all(watched.map(async table=>[table,await query("select md5(coalesce(jsonb_agg(to_jsonb(r) order by id)::text,'[]')) from public."+table+' r where id not in ('+[i.event,i.trip,i.stop].map(q).join(',')+');')])));
 const initial=await snapshot();await installEventChatFixture(adapter);
 await query('insert into drivers(id,tenant_id,user_id,name,active) values '+[[i.driver,i.tenant,i.user,'Motorista evento'],[i.peerDriver,i.tenant,i.peerUser,'Outro motorista evento']].map(row=>'('+row.map(q).join(',')+',true)').join(',')+';'+
  'insert into tenant_memberships(tenant_id,user_id,role,active) values '+[[i.user,'driver'],[i.peerUser,'driver'],[i.replacement,'driver'],[i.operator,'operator']].map(([id,role])=>'('+[i.tenant,id,role].map(q).join(',')+',true)').join(',')+';'+
  'insert into profiles(id,full_name) values('+q(i.operator)+",'Operação evento nativo');"+
  'insert into dispatch_trips(id,tenant_id,driver_id,status,created_at) values('+[i.trip,i.tenant,i.driver,'planned'].map(q).join(',')+',now());'+
  'insert into dispatch_stops(id,tenant_id,dispatch_trip_id,status) values('+[i.stop,i.tenant,i.trip,'pending'].map(q).join(',')+');'+
  'insert into operational_events(id,tenant_id,driver_id,dispatch_trip_id,dispatch_stop_id,event_type,description) values('+[i.event,i.tenant,i.driver,i.trip,i.stop,'other','Ocorrência nativa sintética'].map(q).join(',')+');');
 const api=actor=>'set request.jwt.claim.sub='+q(actor)+";set request.jwt.claims='{}';set role authenticated;";
 const context=async(actor=i.user)=>JSON.parse(await query(api(actor)+'select get_event_chat_context('+q(i.tenant)+','+q(i.event)+');'));
 const payload=async(actor=i.user)=>{const c=await context(actor);return {version:1,tenant_id:i.tenant,actor_id:actor,driver_id:c.driver_id,event_id:i.event,request_id:randomUUID(),expected_revision:c.revision,message:'Mensagem nativa da ocorrência '+randomUUID()};};
 const call=p=>api(p.actor_id)+'select send_event_chat_message('+q(JSON.stringify(p))+'::jsonb);';
 const list=async(actor=i.user)=>JSON.parse(await query(api(actor)+'select list_event_chat_messages('+q(i.tenant)+','+q(i.event)+',null);'));
 const count=()=>query('select count(*) from operational_event_messages;');
 const held=async(winner,loser)=>{const h=session('event-chat-holder');h.send('begin;'+winner+"select '__EVENT_CHAT_HELD__';");await waitForMarker(h,'__EVENT_CHAT_HELD__');try{await assert.rejects(()=>query(loser),/40001.*driver_chat_concurrent_change/);}finally{await finish(h,'commit;');}};
 const tests=[
  ['event chat migration preserves previous operational and financial evidence and closes direct writes',async()=>{
   const sql=eventChatSql();await query('begin;'+sql+'commit;');console.log('Event chat candidate SHA256: '+createHash('sha256').update(sql).digest('hex'));
   assert.equal(await query("select has_table_privilege('authenticated','operational_event_messages','insert');"),'f');assert.deepEqual(await snapshot(),initial);
  }],
  ['concurrent event message retries serialize and confirm one message',async()=>{
   const p=await payload(),before=Number(await count());await contested(call(p),call(p),{driver:false});assert.equal(Number(await count()),before+1);assert.deepEqual(JSON.parse(await query(call(p))),JSON.parse(await query(call(p))));
  }],
  ['held event reassignment rejects a stale operation send without a partial message',async()=>{
   const p=await payload(i.operator),before=await count();try{await held('update operational_events set driver_id='+q(i.peerDriver)+' where id='+q(i.event)+';',call(p));await assert.rejects(()=>query(call(p)),/40001.*driver_chat_context_changed/);assert.deepEqual((await list(i.peerUser)).messages,[]);}finally{await query('update operational_events set driver_id='+q(i.driver)+' where id='+q(i.event)+';');}assert.equal(await count(),before);
  }],
  ['actor revocation during event message request-key wait is rechecked before acceptance',async()=>{
   const p=await payload(),before=await count(),lock="select pg_advisory_xact_lock(hashtext('event-chat-message'),hashtext("+q(i.tenant+':'+i.user+':'+p.request_id)+'))';
   try{const result=await contested(lock,call(p),{driver:false,waiterSucceeds:false,holderAfterBlocked:'update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)});assert.match(result.error,/42501.*driver_chat_not_authorized/);}
   finally{await query('update tenant_memberships set active=true where tenant_id='+q(i.tenant)+' and user_id='+q(i.user)+';');}assert.equal(await count(),before);
  }],
  ['trip reassignment cannot transfer an explicit-driver event or its conversation',async()=>{
   const p=await payload(i.operator);try{await held('update dispatch_trips set driver_id='+q(i.peerDriver)+' where id='+q(i.trip)+';',call(p));await assert.rejects(()=>list(i.peerUser),/42501.*driver_chat_not_authorized/);
    assert.equal(await query(api(i.peerUser)+'select count(*) from operational_events where id='+q(i.event)+';'),'0');await query(call(p));assert.ok((await list()).messages.length>0);
   }finally{await query('update dispatch_trips set driver_id='+q(i.driver)+' where id='+q(i.trip)+';');}
  }],
  ['held driver account replacement fails fast and the new account receives no historical messages',async()=>{
   const p=await payload(i.operator),before=await count();try{await held('update drivers set user_id='+q(i.replacement)+' where id='+q(i.driver)+';',call(p));await assert.rejects(()=>query(call(p)),/40001.*driver_chat_context_changed/);assert.deepEqual((await list(i.replacement)).messages,[]);}finally{await query('update drivers set user_id='+q(i.user)+' where id='+q(i.driver)+';');}assert.equal(await count(),before);
  }],
  ['late event message failure rolls back and leaves preexisting business evidence unchanged',async()=>{
   const p=await payload(i.operator),before=await count();await query("create function qa_event_chat_fail() returns trigger language plpgsql as $$begin raise exception 'QA native event message failure';end;$$;create trigger z_qa_event_chat_fail after insert on operational_event_messages for each row execute function qa_event_chat_fail();");
   try{await assert.rejects(()=>query(call(p)),/QA native event message failure/);}finally{await query('drop trigger z_qa_event_chat_fail on operational_event_messages;drop function qa_event_chat_fail();');}
   assert.equal(await count(),before);await query(call(p));assert.equal(Number(await count()),Number(before)+1);assert.deepEqual(await snapshot(),initial);
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
