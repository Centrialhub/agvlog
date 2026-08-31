import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {installCompositionFixture,compositionCandidateSql,compositionIds as i,seedComposition} from '../src/test/helpers/compositionDatabase.ts';
import {planningPayload} from '../src/test/helpers/planningDatabase.ts';

// Same captured planning/financial graph, actual native PostgreSQL sessions.
// All rows and identities here are synthetic; the harness has no production DSN.
export async function runCompositionConcurrency(ctx){
  const {query,session,finish,waitForMarker,literal:q}=ctx;
  await installCompositionFixture({exec:query});await query('begin;'+compositionCandidateSql+'commit;');
  const operator=`select set_config('request.jwt.claim.sub',${q(i.operator)},false);`;
  const driver=`select set_config('request.jwt.claim.sub',${q(i.user)},false);set role authenticated;`;
  const move=(item=i.item,target=i.load2)=>`select public.move_load_items_between_loads(${q(i.tenant)},${q(i.load)},${q(target)},array[${q(item)}]::uuid[])`;
  const invoke=sql=>`${operator}set role authenticated;${sql}`;
  async function seed(){
    const statements=[];
    await seedComposition({exec:async sql=>{statements.push(sql);},query:async(sql,params)=>{
      statements.push(sql.replace(/\$(\d+)/g,(_,index)=>q(params[Number(index)-1]))+';');
    }});await query(statements.join('\n'));
  }
  async function conflict(holderSql,waiterSql=invoke(move()),after=''){
    const holder=session('composition-qa-holder');holder.send(`begin;${operator}${holderSql};select '__COMPOSITION_HELD__';`);
    await waitForMarker(holder,'__COMPOSITION_HELD__');
    const waiter=await finish(session('composition-qa-waiter'),`begin;${waiterSql};commit;`,false);
    assert.notEqual(waiter.code,0);assert.match(waiter.error,/40001/);
    await finish(holder,`${after};commit;`);
  }
  const counts=()=>query(`select (select count(*) from public.load_items)||','||(select count(*) from public.fiscal_documents)||','||
    (select count(*) from public.entity_audit_log where action='move_items_out')||','||(select count(*) from public.driver_settlements)||','||
    (select count(*) from public.driver_settlement_payments);`);
  const recovery=readFileSync('docs/qa/COMPOSITION-RECOVERY-2026-08-30.sql','utf8');
  const recoveryBody=recovery.replace(/^begin;$/m,'').replace(/^commit;$/m,'');
  const state=()=>query(`select jsonb_build_object(${[
    'loads','load_items','fiscal_documents','dispatch_trips','dispatch_trip_loads','dispatch_stops',
    'dispatch_stop_documents','dispatch_events','entity_audit_log','driver_settlements','driver_settlement_payments',
  ].map(table=>`${q(table)},(select jsonb_agg(to_jsonb(t) order by id) from public.${table} t)`).join(',')});`);
  const contracts=()=>query(`select jsonb_agg(jsonb_build_array(p.oid::regprocedure::text,
    md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),p.proacl) order by p.oid::regprocedure::text)
    from pg_proc p where p.pronamespace='public'::regnamespace and p.proname in(
      '_load_is_locked','move_load_items_between_loads','recalc_load_totals','delete_load_if_empty');`);
  async function sharedTrip(){
    await query(invoke(move(i.item2))+';');const payload=planningPayload();payload.load_ids=[i.load,i.load2];payload.stops[0].load_ids=[i.load,i.load2];
    await query(invoke(`select public.dispatch_planned_route(${q(JSON.stringify(payload))}::jsonb)`)+';');
    return query('select id from public.dispatch_trips;');
  }
  const tests=[
    ['composition serializes competing transfers of the same item without a partial second move',async()=>{
      await seed();await conflict(invoke(move()),invoke(move()));
      await assert.rejects(()=>query(invoke(move())+';'),/23514.*composition_items_changed/);
      assert.equal(await counts(),'2,2,1,0,0');
      assert.equal(await query(`select load_id from public.load_items where id=${q(i.item)};`),i.load2);
    }],
    ...[
      ['source load',`select id from public.loads where id=${q(i.load)} for update`],
      ['target load',`select id from public.loads where id=${q(i.load2)} for update`],
      ['document',`select id from public.fiscal_documents where id=${q(i.doc)} for update`],
      ['item',`select id from public.load_items where id=${q(i.item)} for update`],
      ['membership',`select user_id from public.tenant_memberships where user_id=${q(i.operator)} for update`],
    ].map(([label,lock])=>[`composition handles a held ${label} without retaining reverse-order parent locks`,async()=>{
      await seed();await conflict(lock,invoke(move()),`select id from public.loads where id=${q(i.load)} for update nowait`);
      assert.equal(await counts(),'2,2,0,0,0');await query(invoke(move())+';');assert.equal(await counts(),'2,2,1,0,0');
    }]),
    ['composition revalidates target tenant after a competing reassignment commits',async()=>{
      await seed();await conflict(`update public.loads set tenant_id=${q(i.otherTenant)} where id=${q(i.load2)}`);
      await assert.rejects(()=>query(invoke(move())+';'),/23514.*load_ownership_mismatch/);
      assert.equal(await query(`select load_id from public.load_items where id=${q(i.item)};`),i.load);
      assert.equal(await counts(),'2,2,0,0,0');
    }],
    ['composition conflicts with a held planned trip before modifying any document or stop',async()=>{
      await seed();const trip=await sharedTrip();await conflict(`select id from public.dispatch_trips where id=${q(trip)} for update`);
      assert.equal(await query(`select load_id from public.dispatch_stop_documents where fiscal_document_id=${q(i.doc)};`),i.load);
      await query(invoke(move())+';');assert.equal(await query(`select load_id from public.dispatch_stop_documents where fiscal_document_id=${q(i.doc)};`),i.load2);
    }],
    ['composition and departure do not race a started item into another load',async()=>{
      await seed();const trip=await sharedTrip();await conflict(`${driver}select public.driver_start_trip(${q(trip)})`,invoke(move()));
      await assert.rejects(()=>query(invoke(move())+';'),/23514.*load_locked/);
      assert.equal(await query(`select load_id from public.load_items where id=${q(i.item)};`),i.load);
      assert.equal(await query("select count(*) from public.dispatch_events where event_type='trip_started';"),'1');
    }],
    ['manual insertion racing cleanup cannot lose the load or inserted cargo',async()=>{
      await seed();const manual='91000000-0000-4000-8000-000000000099';
      const holder=session('composition-cleanup-holder');holder.send(`begin;${operator}
        insert into public.load_items(id,tenant_id,load_id,quantity,weight_kg) values(${q(manual)},${q(i.tenant)},${q(i.load2)},1,5);
        select '__MANUAL_HELD__';`);
      await waitForMarker(holder,'__MANUAL_HELD__');
      // Cleanup intentionally skips conflicts rather than forcing or retrying deletion.
      await query(`${operator}select public.delete_load_if_empty(${q(i.load2)});`);await finish(holder,'commit;');
      await query(`${operator}select public.delete_load_if_empty(${q(i.load2)});`);
      assert.equal(await query(`select count(*) from public.loads where id=${q(i.load2)};`),'1');
      assert.equal(await query(`select count(*) from public.load_items where id=${q(manual)};`),'1');
    }],
    ['same-trip move feeds departure, delivery and financial settlement without losing documents',async()=>{
      await seed();const trip=await sharedTrip();await query(invoke(move())+';');
      await query(`${driver}select public.driver_start_trip(${q(trip)});`);
      const stop=await query('select id from public.dispatch_stops;');
      await query(`update public.dispatch_stops set status='arrived',actual_arrival_at=now() where id=${q(stop)};`);
      await query(`${driver}select public.driver_record_delivery_outcome(${q(stop)},'failed','{"notes":"QA sem entrega"}',${q(i.request)},'arrived');`);
      assert.equal(await query('select status from public.loads;'),'failed');assert.equal(await query('select status from public.dispatch_trips;'),'completed');
      assert.equal(await query('select count(*) from public.dispatch_stop_documents;'),'2');
      assert.equal(await query('select status from public.driver_settlements;'),'pending_review');assert.equal(await query('select count(*) from public.driver_settlement_payments;'),'0');
    }],
    ...[
      ['function drift','alter function public._load_is_locked(uuid) set search_path=public;'],
      ['grant drift','grant execute on function public._load_is_locked(uuid) to authenticated;'],
      ['trigger drift','alter table public.load_items disable trigger trg_recalc_load_totals;'],
    ].map(([label,drift])=>[`composition recovery refuses ${label} without changing business evidence`,async()=>{
      const before=await state();const beforeContracts=await contracts();
      await assert.rejects(()=>query('begin;'+drift+recoveryBody+'commit;'),/Composition recovery refused/);
      assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
      assert.equal(await query("select tgenabled from pg_trigger where tgname='trg_recalc_load_totals';"),'O');
    }]),
    ['composition recovery restores captured contracts and reapplication preserves delivery and financial evidence',async()=>{
      const before=await state();const beforeContracts=await contracts();const started=performance.now();
      await query(recovery);assert.equal(await state(),before);
      await query('begin;'+compositionCandidateSql+'commit;');
      assert.equal(await state(),before);assert.equal(await contracts(),beforeContracts);
      assert.equal(await query(`select public._load_is_locked(${q(i.load2)});`),'t');
      assert.equal(await query('select count(*) from public.driver_settlement_payments;'),'0');
      console.log(`Composition recovery + verification + reapplication: ${Math.round(performance.now()-started)} ms (local fixture)`);
    }],
  ];
  for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}
  return tests.length;
}
