import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {itemWriterCandidateSql,itemWriterIds as i,seedItemWriter,itemWriterSignature} from '../src/test/helpers/loadItemWriterDatabase.ts';
import {planningPayload} from '../src/test/helpers/planningDatabase.ts';
export async function runItemPreparationConcurrency(ctx){
 const {query,session,finish,waitForMarker,contested,literal:q}=ctx;
 await query('begin;'+itemWriterCandidateSql+'commit;');
 const operator=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const driver=`set request.jwt.claim.sub=${q(i.user)};set role authenticated;`;
 const call=p=>`${operator}select save_load_item_preparation(${q(JSON.stringify(p))}::jsonb)`;
 const legacy=`${operator}select upsert_load_item_v3(p_tenant_id=>${q(i.tenant)},p_item_id=>${q(i.item)},p_status=>'loaded')`;
 const recovery=readFileSync('docs/qa/ITEM-PREPARATION-RECOVERY-2026-08-30.sql','utf8');
 const recoveryBody=recovery.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
 const olderRecovery=readFileSync('docs/qa/DOCUMENT-CHANGES-RECOVERY-2026-08-30.sql','utf8');
 const expected=JSON.parse(readFileSync('docs/qa/ITEM-PREPARATION-LOCAL-CONTRACTS-2026-08-30.json','utf8'));
 const state=()=>query(`select jsonb_build_object(${[
  'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
  'dispatch_events','operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
 ].map(t=>`${q(t)},(select jsonb_agg(to_jsonb(t) order by id) from public.${t} t)`).join(',')});`);
 const contracts=()=>query(`select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),p.proacl) order by p.oid::regprocedure::text)
  from pg_proc p where p.oid=any(array[${expected.candidate.map(f=>q('public.'+f.signature)+'::regprocedure').join(',')}]::oid[]);`);
 const counts=()=>query(`select (select count(*) from idempotency_keys where operation='save_load_item_preparation')||','||
  (select count(*) from entity_audit_log where source='item_preparation')||','||(select count(*) from driver_settlements)||','||(select count(*) from driver_settlement_payments);`);
 async function seed(){const statements=[];await seedItemWriter({exec:async sql=>{statements.push(sql);},query:async(sql,params)=>{
  statements.push(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1]))+';');}});await query(statements.join('\n'));await query('truncate storage.objects;');}
 const create=()=>({tenant_id:i.tenant,load_id:i.load2,item_id:null,values:{item_description:'Manual concorrente',quantity:3,pallet_count:1},expected:null,request_id:i.request});
 const update=()=>({tenant_id:i.tenant,load_id:i.load,item_id:i.item,values:{status:'loaded'},expected:{status:'pending'},request_id:i.request});
 async function planned(){await seed();const trip=await query(`${operator}select dispatch_planned_route(${q(JSON.stringify(planningPayload()))}::jsonb);`);
  const stop=await query(`select id from dispatch_stops where dispatch_trip_id=${q(trip)};`);return {trip,stop};}
 async function conflict(held,payload,after=''){const holder=session('item-preparation-holder');holder.send(`begin;${held};select '__ITEM_HELD__';`);
  await waitForMarker(holder,'__ITEM_HELD__');const rejected=await finish(session('item-preparation-waiter'),`begin;${call(payload)};commit;`,false);
  assert.notEqual(rejected.code,0);assert.match(rejected.error,/40001/);await finish(holder,'reset role;'+after+';commit;');}
 const tests=[
  ['preparation identical creates wait and confirm only one manual item',async()=>{
   await seed();const p=create();await contested(call(p),call(p),{driver:false});assert.equal(await counts(),'1,1,0,0');
   assert.equal(await query(`select count(*) from load_items where load_id=${q(i.load2)};`),'1');
  }],
  ['preparation request-key reuse with another body cannot duplicate cargo',async()=>{
   await seed();const p=create();const rejected=await contested(call(p),call({...p,values:{quantity:99}}),{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/22023.*idempotency_mismatch/);assert.equal(await counts(),'1,1,0,0');
  }],
  ['preparation conflicts with a legacy edit and rejects its stale field after commit',async()=>{
   const d=await planned(),p={...update(),values:{status:'picking'}};await conflict(legacy,p,`select id from load_items where id=${q(i.item)} for update nowait`);
   assert.equal(await counts(),'0,1,0,0');await assert.rejects(()=>query(call(p)+';'),/40001.*expected_changed/);
   await query(call({...p,expected:{status:'loaded'}})+';');assert.equal(await counts(),'1,2,0,0');
   assert.equal(await query(`select status from dispatch_trips where id=${q(d.trip)};`),'planned');
  }],
  ...[
   ['trip',d=>`select id from dispatch_trips where id=${q(d.trip)} for update`],
   ['load',()=>`select id from loads where id=${q(i.load)} for update`],
   ['document',()=>`select id from fiscal_documents where id=${q(i.doc)} for update`],
   ['item',()=>`select id from load_items where id=${q(i.item)} for update`],
   ['order',()=>`select id from orders where id=${q(i.request)} for update`],
   ['membership',()=>`select user_id from tenant_memberships where user_id=${q(i.operator)} for update`],
  ].map(([name,lock])=>[`preparation rejects held ${name} without retaining reverse-order locks`,async()=>{
   const d=await planned();await query(`insert into orders values(${q(i.request)},${q(i.tenant)});`);
   const p={...update(),values:{status:'loaded',order_id:i.request},expected:{status:'pending',order_id:null}};
   await conflict(lock(d),p,`select id from dispatch_trips where id=${q(d.trip)} for update nowait`);
   assert.equal(await counts(),'0,0,0,0');await query(call(p)+';');assert.equal(await counts(),'1,1,0,0');
  }]),
  ['preparation revalidates membership revoked while waiting for a committed request key',async()=>{
   await seed();const p=create();await query(call(p)+';');const key=`save_load_item_preparation:${i.operator}:${i.request}`;
   const rejected=await contested(`select pg_advisory_xact_lock(hashtext('save_load_item_preparation'),hashtext(${q(i.tenant+':'+key)}))`,call(p),{
    driver:false,waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(rejected.error,/42501.*not_authorized/);assert.equal(await counts(),'1,1,0,0');
  }],
  ['preparation does not race an actual driver departure',async()=>{
   const d=await planned();await conflict(`${driver}select driver_start_trip(${q(d.trip)})`,update());
   await assert.rejects(()=>query(call(update())+';'),/23514.*load_locked/);assert.equal(await counts(),'0,0,0,0');
  }],
  ['preparation feeds departure, delivery proofs and pending settlement without changing invoice identity',async()=>{
   const d=await planned();await query(call(update())+';');await query(`${driver}select driver_start_trip(${q(d.trip)});`);
   await query(`update dispatch_stops set status='arrived',actual_arrival_at=now() where id=${q(d.stop)};`);
   const prefix=`${i.tenant}/deliveries/${d.trip}/${d.stop}/`,details={receiver_name:'Recebedor QA',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
   await query(`insert into storage.objects(bucket_id,name) values('receipts',${q(details.photo_paths[0])}),('receipts',${q(details.signature_path)});`);
   await query(`${driver}select driver_record_delivery_outcome(${q(d.stop)},'delivered',${q(JSON.stringify(details))}::jsonb,${q(i.request)},'arrived');`);
   assert.equal(await query(`select status from loads where id=${q(i.load)};`),'delivered');assert.equal(await query(`select status from dispatch_trips where id=${q(d.trip)};`),'completed');
   assert.equal(await query('select count(*) from proof_of_delivery;'),'2');assert.equal(await query("select count(*) from fiscal_documents where status='delivered';"),'2');
   assert.equal(await query(`select fiscal_document_id from load_items where id=${q(i.item)};`),i.doc);
   assert.equal(await query('select status from driver_settlements;'),'pending_review');assert.equal(await counts(),'1,1,1,0');
  }],
  ['item recovery refuses recorded use and preserves delivery/financial evidence',async()=>{
   const before=await state(),beforeContracts=await contracts();await assert.rejects(()=>query(recovery),/Item preparation recovery refused: business usage exists/);
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);assert.equal(await counts(),'1,1,1,0');
  }],
  ...[
   ['recoverable API',()=>call(create()),'1,1,0,0'],
   ['legacy writer',()=>legacy,'0,1,0,0'],
  ].map(([name,sql,expectedCounts])=>[`item recovery waits for the ${name} commit before refusing`,async()=>{
   await seed();const rejected=await contested(sql(),recoveryBody,{driver:false,waiterSucceeds:false});
   assert.match(rejected.error,/Item preparation recovery refused: business usage exists/);assert.equal(await counts(),expectedCounts);
  }]),
  ...[
   ['function','alter function public.save_load_item_preparation(jsonb) set search_path=public;'],
   ['grant','grant execute on function public.save_load_item_preparation(jsonb) to anon;'],
   ['RLS','alter table public.idempotency_keys disable row level security;'],
   ['read policy','alter policy agvlog_select_authenticated on public.idempotency_keys using(true);'],
   ['column',"alter table public.idempotency_keys alter column response_body set default '{}';"],
  ].map(([name,drift])=>[`item recovery refuses ${name} drift and changes no business records`,async()=>{
   await planned();const before=await state(),beforeContracts=await contracts();
   await assert.rejects(()=>query('begin;'+drift+recoveryBody+'commit;'),/Item preparation recovery refused/);
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
  }]),
  ['older document recovery refuses an unused newer preparation writer',async()=>{
   await planned();const before=await state(),beforeContracts=await contracts();
   await assert.rejects(()=>query(olderRecovery),/Document change recovery refused: newer item preparation writer exists/);
   assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
  }],
  ['unused item recovery restores the exact predecessor and reapplies without changing routes',async()=>{
   await planned();const before=await state(),beforeContracts=await contracts(),started=performance.now();await query(recovery);
   assert.equal(await query(`select md5(replace(pg_get_functiondef(${q('public.'+itemWriterSignature)}::regprocedure),E'\\r\\n',E'\\n'));`),expected.predecessor[0].hash);
   assert.equal(await query("select to_regprocedure('public.save_load_item_preparation(jsonb)') is null;"),'t');
   assert.equal(await state(),before);await query('begin;'+itemWriterCandidateSql+'commit;');assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
   console.log(`Unused item recovery + verification + reapplication: ${Math.round(performance.now()-started)} ms (local fixture)`);
  }],
 ];
 for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}return tests.length;
}
