import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {documentChangeCandidateSql,documentChangeIds as i,seedDocumentChanges} from '../src/test/helpers/documentChangesDatabase.ts';
import {replanningCandidateSql} from '../src/test/helpers/replanningDatabase.ts';
import {planningPayload} from '../src/test/helpers/planningDatabase.ts';
export async function runDocumentChangeConcurrency(ctx){
 const {query,session,finish,waitForMarker,contested,literal:q}=ctx;
 await query('begin;'+documentChangeCandidateSql+'commit;');
 const operator=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const driver=`set request.jwt.claim.sub=${q(i.user)};set role authenticated;`;
 const call=payload=>`${operator}select change_load_documents(${q(JSON.stringify(payload))}::jsonb)`;
 const recovery=readFileSync('docs/qa/DOCUMENT-CHANGES-RECOVERY-2026-08-30.sql','utf8');
 const recoveryBody=recovery.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 const priorRecovery=readFileSync('docs/qa/REPLANNING-RECOVERY-2026-08-30.sql','utf8');
 const expected=JSON.parse(readFileSync('docs/qa/DOCUMENT-CHANGES-LOCAL-CONTRACTS-2026-08-30.json','utf8'));
 const state=()=>query(`select jsonb_build_object(${[
  'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
  'dispatch_events','operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
 ].map(table=>`${q(table)},(select jsonb_agg(to_jsonb(t) order by id) from public.${table} t)`).join(',')});`);
 const contracts=()=>query(`select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,
  md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),p.proacl) order by p.oid::regprocedure::text)
  from pg_proc p where p.oid=any(array[${expected.candidate.map(f=>q('public.'+f.signature)+'::regprocedure').join(',')}]::oid[]);`);
 async function seed(){const statements=[];await seedDocumentChanges({exec:async sql=>{statements.push(sql);},query:async(sql,params)=>{
  statements.push(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]))+';');}});await query(statements.join('\n'));await query('truncate storage.objects;');}
 async function payload(action='attach',stop=null){const docs=action==='attach'?[i.doc3]:[i.doc];
  const context=JSON.parse(await query(`${operator}select get_load_document_change_context(${q(i.tenant)},${q(i.load)},array[${docs.map(q).join(',')}]::uuid[]);`));
  return {tenant_id:i.tenant,load_id:i.load,document_ids:docs,action,request_id:i.request,revision:context.revision,
   reason:'QA native document composition',target_stop:action==='detach'?null:stop?{mode:'existing',stop_id:stop}:{mode:'unassigned'}};
 }
 async function planned(){await seed();const plan=planningPayload();const trip=await query(`${operator}select dispatch_planned_route(${q(JSON.stringify(plan))}::jsonb);`);
  const stop=await query(`select id from dispatch_stops where dispatch_trip_id=${q(trip)};`);return {trip,stop,payload:await payload('attach',stop)};}
 const counts=()=>query(`select (select count(*) from idempotency_keys where operation='change_load_documents')||','||
  (select count(*) from entity_audit_log where source='document_composition')||','||(select count(*) from driver_settlements)||','||(select count(*) from driver_settlement_payments);`);
 async function conflict(sql,data,after=''){const holder=session('document-change-holder');holder.send(`begin;${sql};select '__DOCUMENT_HELD__';`);
  await waitForMarker(holder,'__DOCUMENT_HELD__');const rejected=await finish(session('document-change-waiter'),`begin;${call(data)};commit;`,false);
  assert.notEqual(rejected.code,0);assert.match(rejected.error,/40001/);await finish(holder,after+';commit;');}
 const tests=[
  ['document attachment identical requests wait and create one item/stop assignment',async()=>{
   const data=await planned();await contested(call(data.payload),call(data.payload),{driver:false});assert.equal(await counts(),'1,1,0,0');
   assert.equal(await query(`select count(*) from load_items where fiscal_document_id=${q(i.doc3)};`),'1');
   assert.equal(await query(`select count(*) from dispatch_stop_documents where fiscal_document_id=${q(i.doc3)};`),'1');
  }],
  ['document changes reject changed content using a committed key',async()=>{
   const data=await planned();const rejected=await contested(call(data.payload),call({...data.payload,reason:'Changed'}),{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/22023.*document_change_idempotency_mismatch/);assert.equal(await counts(),'1,1,0,0');
  }],
  ...[
   ['trip',d=>`select id from dispatch_trips where id=${q(d.trip)} for update`],
   ['load',()=>`select id from loads where id=${q(i.load)} for update`],
   ['document',()=>`select id from fiscal_documents where id=${q(i.doc3)} for update`],
   ['item',()=>`select id from load_items where id=${q(i.item)} for update`],
   ['stop',d=>`select id from dispatch_stops where id=${q(d.stop)} for update`],
   ['membership',()=>`select user_id from tenant_memberships where user_id=${q(i.operator)} for update`],
  ].map(([name,lock])=>[`document changes reject a held ${name} without retaining reverse-order locks`,async()=>{
   const data=await planned();await conflict(lock(data),data.payload,`select id from dispatch_trips where id=${q(data.trip)} for update nowait`);
   assert.equal(await counts(),'0,0,0,0');await query(call(data.payload)+';');assert.equal(await counts(),'1,1,0,0');
  }]),
  ['document removal waits/replays after the last invoice and source load disappear',async()=>{
   await seed();await query(`${operator}select remove_fiscal_documents_from_load_v2(${q(i.tenant)},${q(i.load)},array[${q(i.doc2)}]::uuid[]);`);
   const data=await payload('detach');await contested(call(data),call(data),{driver:false});
   assert.equal(await query(`select count(*) from loads where id=${q(i.load)};`),'0');assert.equal(await counts(),'1,2,0,0');
  }],
  ['document changes recheck membership revoked while waiting for the request key',async()=>{
   const data=await planned();await query(call(data.payload)+';');const key=`change_load_documents:${i.operator}:${i.request}`;
   const rejected=await contested(`select pg_advisory_xact_lock(hashtext('change_load_documents'),hashtext(${q(i.tenant+':'+key)}))`,call(data.payload),{
    driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(rejected.error,/42501.*not_authorized/);assert.equal(await counts(),'1,1,0,0');
  }],
  ['document changes do not race an actual departure',async()=>{
   const data=await planned();await conflict(`${driver}select driver_start_trip(${q(data.trip)})`,data.payload);
   await assert.rejects(()=>query(call(data.payload)+';'),/23514.*load_locked/);assert.equal(await counts(),'0,0,0,0');
  }],
  ['document changes rollback leaves neither a response key nor a partial attachment',async()=>{
   const data=await planned();await query('begin;'+call(data.payload)+';rollback;');assert.equal(await counts(),'0,0,0,0');
   await query(call(data.payload)+';');assert.equal(await counts(),'1,1,0,0');
  }],
  ['planned add/remove feeds driver delivery and pending settlement with only the remaining notes',async()=>{
   const data=await planned();await query(call(data.payload)+';');const removal=await payload('detach');removal.request_id=i.request2;
   await query(call(removal)+';');await query(`${driver}select driver_start_trip(${q(data.trip)});`);
   await query(`update dispatch_stops set status='arrived',actual_arrival_at=now() where id=${q(data.stop)};`);
   const prefix=`${i.tenant}/deliveries/${data.trip}/${data.stop}/`;const details={receiver_name:'QA Receiver',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
   await query(`insert into storage.objects(bucket_id,name) values('receipts',${q(details.photo_paths[0])}),('receipts',${q(details.signature_path)});`);
   await query(`${driver}select driver_record_delivery_outcome(${q(data.stop)},'delivered',${q(JSON.stringify(details))}::jsonb,${q(i.request)},'arrived');`);
   assert.equal(await query(`select status from loads where id=${q(i.load)};`),'delivered');
   assert.equal(await query(`select status from dispatch_trips where id=${q(data.trip)};`),'completed');
   assert.equal(await query('select count(*) from proof_of_delivery;'),'2');
   assert.equal(await query(`select load_id is null and status='confirmed' from fiscal_documents where id=${q(i.doc)};`),'t');
   assert.equal(await query('select status from driver_settlements;'),'pending_review');assert.equal(await counts(),'2,2,1,0');
  }],
  ['document recovery refuses after delivery and preserves fiscal, proof and settlement evidence',async()=>{
   const before=await state(),beforeContracts=await contracts();
   await assert.rejects(()=>query(recovery),/Document change recovery refused: business usage exists/);
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);assert.equal(await counts(),'2,2,1,0');
  }],
  ['document recovery waits for the new API commit then refuses without erasing its response',async()=>{
   const data=await planned();const rejected=await contested(call(data.payload),recoveryBody,{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/Document change recovery refused: business usage exists/);assert.equal(await counts(),'1,1,0,0');
   await query(call(data.payload)+';');assert.equal(await counts(),'1,1,0,0');
  }],
  ...['assign_fiscal_documents_to_load_v2','remove_fiscal_documents_from_load_v2'].map(name=>[
   `document recovery also waits for legacy ${name} without a response-cache write`,async()=>{
    await seed();const doc=name.startsWith('assign')?i.doc3:i.doc;
    const legacy=`${operator}select public.${name}(${q(i.tenant)},${q(i.load)},array[${q(doc)}]::uuid[])`;
    const rejected=await contested(legacy,recoveryBody,{driver:false,waiterSucceeds:false});
    assert.match(rejected.error,/Document change recovery refused: business usage exists/);assert.equal(await counts(),'0,1,0,0');
   },
  ]),
  ...[
   ['function','alter function public.change_load_documents(jsonb) set search_path=public;'],
   ['grant','grant execute on function public.change_load_documents(jsonb) to anon;'],
   ['private helper grant','grant execute on function public._lock_load_document_graph(uuid,uuid) to authenticated;'],
   ['RLS','alter table public.idempotency_keys disable row level security;'],
   ['write policy','create policy qa_cache_write on public.idempotency_keys for insert to authenticated with check(true);'],
   ['read policy','alter policy agvlog_select_authenticated on public.idempotency_keys using(true);'],
  ].map(([name,drift])=>[`document recovery refuses ${name} drift before altering business data or contracts`,async()=>{
   await planned();const before=await state(),beforeContracts=await contracts();
   await assert.rejects(()=>query('begin;'+drift+recoveryBody+'commit;'),/Document change recovery refused/);
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
  }]),
  ['older replanning recovery refuses an unused newer document API',async()=>{
   await planned();const before=await state(),beforeContracts=await contracts();
   await assert.rejects(()=>query(priorRecovery),/Replanning recovery refused: newer document composition APIs exist/);
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
  }],
  ['unused document recovery restores predecessors and reapplies without changing planned routes',async()=>{
   await planned();const before=await state(),beforeContracts=await contracts(),started=performance.now();
   await query(recovery);
   for(const f of expected.predecessor){
    assert.equal(await query(`select md5(replace(pg_get_functiondef(${q('public.'+f.signature)}::regprocedure),E'\\r\\n',E'\\n'));`),f.hash);
   }
   assert.equal(await query("select to_regprocedure('public.change_load_documents(jsonb)') is null;"),'t');
   assert.equal(await state(),before);await query('begin;'+documentChangeCandidateSql+'commit;');
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);assert.equal(await counts(),'0,0,0,0');
   console.log(`Unused document recovery + verification + reapplication: ${Math.round(performance.now()-started)} ms (local fixture)`);
  }],
  ['unused document and replanning recoveries run only in reverse order and reapply cleanly',async()=>{
   await planned();const before=await state(),beforeContracts=await contracts();
   await query(recovery);assert.equal(await state(),before);await query(priorRecovery);
   // The older recovery intentionally removes response_body; compare the complete
   // row JSON after reapplication restores that column, including existing keys.
   assert.equal(await query("select exists(select 1 from information_schema.columns where table_schema='public' and table_name='idempotency_keys' and column_name='response_body');"),'f');
   await query('begin;'+replanningCandidateSql+documentChangeCandidateSql+'commit;');
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
  }],
 ];
 for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}return tests.length;
}
