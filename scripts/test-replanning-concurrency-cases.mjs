import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {replanningCandidateSql,replanningIds as i,seedReplanning} from '../src/test/helpers/replanningDatabase.ts';
import {planningPayload} from '../src/test/helpers/planningDatabase.ts';

export async function runReplanningConcurrency(ctx){
  const {query,session,finish,waitForMarker,contested,literal:q}=ctx;
  await query('begin;'+replanningCandidateSql+'commit;');
  const asOperator=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
  const asDriver=`set request.jwt.claim.sub=${q(i.user)};set role authenticated;`;
  const call=payload=>`${asOperator}select public.replan_load_items(${q(JSON.stringify(payload))}::jsonb)`;
  const recovery=readFileSync('docs/qa/REPLANNING-RECOVERY-2026-08-30.sql','utf8');
  const recoveryBody=recovery.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  const state=()=>query(`select jsonb_build_object(${[
    'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops','dispatch_stop_documents',
    'dispatch_events','operational_events','proof_of_delivery','entity_audit_log','idempotency_keys','driver_settlements','driver_settlement_payments',
  ].map(table=>`${q(table)},(select jsonb_agg(to_jsonb(t) order by id) from public.${table} t)`).join(',')});`);
  const contracts=()=>query(`select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,
    md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),p.proacl) order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in(
      '_load_replanning_snapshot','_assert_load_replanning_graph','replan_load_items','get_load_replanning_context',
      '_derive_driver_delivery_result','delete_load_if_empty');`);
  const counts=()=>query(`select (select count(*) from public.idempotency_keys where operation='replan_load_items')||','||
    (select count(*) from public.entity_audit_log where action='replan_items_out')||','||
    (select count(*) from public.driver_settlements)||','||(select count(*) from public.driver_settlement_payments);`);
  async function seed(){
    const statements=[];await seedReplanning({exec:async sql=>{statements.push(sql);},query:async(sql,params)=>{
      statements.push(sql.replace(/\$(\d+)/g,(_,index)=>q(params[Number(index)-1]))+';');
    }});await query(statements.join('\n'));await query('truncate storage.objects;');
  }
  async function prepare(shared=false){
    await seed();await query(`${asOperator}select public.move_load_items_between_loads(${q(i.tenant)},${q(i.load)},${q(i.load2)},array[${q(i.item2)}]::uuid[]);`);
    const source=planningPayload();source.stops[0].fiscal_document_ids=[i.doc];
    const target=planningPayload();target.idempotency_key=i.request2;target.load_ids=[i.load2];
    target.stops[0].load_ids=[i.load2];target.stops[0].fiscal_document_ids=[i.doc2];target.stops[0].destination='Destino 2';
    if(shared){source.load_ids=[i.load,i.load2];source.stops.push(target.stops[0]);}
    const sourceTrip=await query(`${asOperator}select public.dispatch_planned_route(${q(JSON.stringify(source))}::jsonb);`);
    const targetTrip=shared?sourceTrip:await query(`${asOperator}select public.dispatch_planned_route(${q(JSON.stringify(target))}::jsonb);`);
    const targetStop=await query(`select id from public.dispatch_stops where dispatch_trip_id=${q(targetTrip)} and destination='Destino 2';`);
    const context=JSON.parse(await query(`${asOperator}select public.get_load_replanning_context(${q(i.tenant)},${q(i.load)},${q(i.load2)});`));
    return {sourceTrip,targetTrip,targetStop,payload:{tenant_id:i.tenant,source_load_id:i.load,target_load_id:i.load2,
      item_ids:[i.item],expected_document_ids:[i.doc],request_id:i.request,reason:'QA replanejamento nativo',revision:context.revision,
      target_stop:{mode:'existing',stop_id:targetStop}}};
  }
  async function conflict(holderSql,payload,after=''){
    const holder=session('replanning-qa-holder');holder.send(`begin;${holderSql};select '__REPLANNING_HELD__';`);
    await waitForMarker(holder,'__REPLANNING_HELD__');
    const rejected=await finish(session('replanning-qa-waiter'),`begin;${call(payload)};commit;`,false);
    assert.notEqual(rejected.code,0);assert.match(rejected.error,/40001/);await finish(holder,`${after};commit;`);
  }
  const tests=[
    ['replanning identical requests wait then replay one transfer even after source deletion',async()=>{
      const {payload}=await prepare();const replay=await contested(call(payload),call(payload),{driver:false});
      assert.ok(replay.output.includes(i.request));assert.equal(await counts(),'1,1,0,0');
      assert.equal(await query(`select count(*) from public.loads where id=${q(i.load)};`),'0');
    }],
    ['replanning same key with changed body waits then rejects without a second audit',async()=>{
      const {payload}=await prepare();const rejected=await contested(call(payload),call({...payload,reason:'Changed'}),{driver:false,waiterSucceeds:false});
      assert.match(rejected.error,/22023.*replanning_idempotency_mismatch/);assert.equal(await counts(),'1,1,0,0');
    }],
    ...[
      ['trip',data=>`select id from public.dispatch_trips where id=${q(data.sourceTrip)} for update`],
      ['source load',()=>`select id from public.loads where id=${q(i.load)} for update`],
      ['target load',()=>`select id from public.loads where id=${q(i.load2)} for update`],
      ['stop',data=>`select id from public.dispatch_stops where id=${q(data.targetStop)} for update`],
      ['link',data=>`select id from public.dispatch_trip_loads where dispatch_trip_id=${q(data.sourceTrip)} for update`],
      ['document',()=>`select id from public.fiscal_documents where id=${q(i.doc)} for update`],
      ['item',()=>`select id from public.load_items where id=${q(i.item)} for update`],
      ['membership',()=>`select user_id from public.tenant_memberships where user_id=${q(i.operator)} for update`],
    ].map(([name,lock])=>[`replanning conflicts with held ${name} without retaining reverse-order graph locks`,async()=>{
      const data=await prepare();await conflict(lock(data),data.payload,`select id from public.dispatch_trips where id=${q(data.sourceTrip)} for update nowait`);
      assert.equal(await counts(),'0,0,0,0');await query(call(data.payload)+';');assert.equal(await counts(),'1,1,0,0');
    }]),
    ['replanning rechecks operator membership after waiting for its request key',async()=>{
      const {payload}=await prepare();await query(call(payload)+';');
      const key=`replan_load_items:${i.operator}:${i.request}`;
      const lock=`select pg_advisory_xact_lock(hashtext('replan_load_items'),hashtext(${q(i.tenant+':'+key)}))`;
      const rejected=await contested(lock,call(payload),{driver:false,waiterSucceeds:false,
        holderAfterBlocked:`update public.tenant_memberships set active=false where user_id=${q(i.operator)}`});
      assert.match(rejected.error,/42501.*not_authorized/);assert.equal(await counts(),'1,1,0,0');
    }],
    ['replanning races departure safely and refuses after the actual start commits',async()=>{
      const data=await prepare();await conflict(`${asDriver}select public.driver_start_trip(${q(data.sourceTrip)})`,data.payload);
      await assert.rejects(()=>query(call(data.payload)+';'),/23514.*load_locked/);
      assert.equal(await query(`select load_id from public.load_items where id=${q(i.item)};`),i.load);assert.equal(await counts(),'0,0,0,0');
    }],
    ['replanning rollback leaves no response cache and the original request can be submitted again',async()=>{
      const {payload}=await prepare();await query(`begin;${call(payload)};rollback;`);assert.equal(await counts(),'0,0,0,0');
      await query(call(payload)+';');assert.equal(await counts(),'1,1,0,0');
    }],
    ['authenticated operators cannot forge the internal replanning response cache through table writes',async()=>{
      const {payload}=await prepare();await query(call(payload)+';');
      await assert.rejects(()=>query(`${asOperator}insert into public.idempotency_keys(tenant_id,key_value,response_body)
        values(${q(i.tenant)},'forged-replay','{}');`),/42501/);assert.equal(await counts(),'1,1,0,0');
    }],
    ['same-trip replanning preserves a cancelled empty stop without turning a full delivery into partial delivery',async()=>{
      const data=await prepare(true);await query(call(data.payload)+';');
      assert.equal(await query("select count(*) from public.dispatch_stops where status='cancelled';"),'1');
      await query(`${asDriver}select public.driver_start_trip(${q(data.targetTrip)});`);
      await query(`update public.dispatch_stops set status='arrived',actual_arrival_at=now() where id=${q(data.targetStop)};`);
      const prefix=`${i.tenant}/deliveries/${data.targetTrip}/${data.targetStop}/`;
      const details={receiver_name:'Recebedor QA',notes:'Entrega após replanejamento',photo_paths:[prefix+'photo.jpg'],signature_path:prefix+'signatures/sign.png'};
      await query(`insert into storage.objects(bucket_id,name) values('receipts',${q(details.photo_paths[0])}),('receipts',${q(details.signature_path)});`);
      await query(`${asDriver}select public.driver_record_delivery_outcome(${q(data.targetStop)},'delivered',${q(JSON.stringify(details))}::jsonb,${q(i.request)},'arrived');`);
      assert.equal(await query('select status from public.loads;'),'delivered');assert.equal(await query('select status from public.dispatch_trips;'),'completed');
      assert.equal(await query('select count(*) from public.proof_of_delivery;'),'2');
      assert.equal(await query("select count(*) from public.dispatch_stops where status='cancelled' and actual_arrival_at is null and actual_departure_at is null;"),'1');
      assert.equal(await query('select status from public.driver_settlements;'),'pending_review');assert.equal(await counts(),'1,1,1,0');
    }],
    ['replanning recovery refuses after use and preserves delivery and financial evidence',async()=>{
      const before=await state();const beforeContracts=await contracts();
      await assert.rejects(()=>query(recovery),/Replanning recovery refused: business usage exists/);
      assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);assert.equal(await counts(),'1,1,1,0');
    }],
    ['replanning recovery waits for an in-flight transfer then refuses its committed business usage',async()=>{
      const {payload}=await prepare();
      const rejected=await contested(call(payload),recoveryBody,{driver:false,waiterSucceeds:false});
      assert.match(rejected.error,/Replanning recovery refused: business usage exists/);
      assert.equal(await counts(),'1,1,0,0');await query(call(payload)+';');assert.equal(await counts(),'1,1,0,0');
    }],
    ...[
      ['function','alter function public.replan_load_items(jsonb) set search_path=public;'],
      ['grant','grant execute on function public.replan_load_items(jsonb) to anon;'],
      ['RLS','alter table public.idempotency_keys disable row level security;'],
      ['write policy','create policy qa_cache_write on public.idempotency_keys for insert to authenticated with check(true);'],
      ['column',"alter table public.idempotency_keys alter column response_body set default '{}';"],
    ].map(([name,drift])=>[`replanning recovery refuses ${name} drift without changing business records`,async()=>{
      await prepare();const before=await state();const beforeContracts=await contracts();
      await assert.rejects(()=>query('begin;'+drift+recoveryBody+'commit;'),/Replanning recovery refused/);
      assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
    }]),
    ['unused replanning recovery restores and reapplies while retaining existing planned routes',async()=>{
      await prepare();const before=await state();const beforeContracts=await contracts();const started=performance.now();
      await query(recovery);assert.equal(await query("select to_regprocedure('public.replan_load_items(jsonb)') is null;"),'t');
      await query('begin;'+replanningCandidateSql+'commit;');
      assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);assert.equal(await counts(),'0,0,0,0');
      console.log(`Unused replanning recovery + verification + reapplication: ${Math.round(performance.now()-started)} ms (local fixture)`);
    }],
  ];
  for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}
  return tests.length;
}
