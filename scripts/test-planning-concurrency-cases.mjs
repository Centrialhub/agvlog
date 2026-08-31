import assert from 'node:assert/strict';
import {installPlanningFixture,planningCandidateSql,planningIds as i,planningPayload,seedPlanning} from '../src/test/helpers/planningDatabase.ts';

// Runs after the real trip/load/financial SQL in the disposable native harness.
// No connection to Supabase or external providers is available to these cases.
export async function runPlanningConcurrency(ctx){
  const {query,session,finish,waitForMarker,contested,literal:q}=ctx;
  await installPlanningFixture({exec:query});
  await query('begin;'+planningCandidateSql+'commit;');
  const actor=`select set_config('request.jwt.claim.sub',${q(i.operator)},false);`;
  const rpc=(payload=planningPayload())=>`select public.dispatch_planned_route(${q(JSON.stringify(payload))}::jsonb)`;
  const call=(payload=planningPayload())=>`${actor}set role authenticated;${rpc(payload)}`;
  async function seed(){
    const statements=[];
    await seedPlanning({exec:async sql=>{statements.push(sql);},query:async(sql,params)=>{
      statements.push(sql.replace(/\$(\d+)/g,(_,index)=>q(params[Number(index)-1]))+';');
    }});
    await query(statements.join('\n'));
  }
  const counts=()=>query(`select (select count(*) from public.dispatch_trips)||','||
    (select count(*) from public.dispatch_trip_loads)||','||(select count(*) from public.dispatch_stops)||','||
    (select count(*) from public.dispatch_stop_documents)||','||(select count(*) from public.idempotency_keys)||','||
    (select count(*) from public.entity_audit_log where action='plan_dispatch')||','||
    (select count(*) from public.driver_settlements)||','||(select count(*) from public.driver_settlement_payments);`);
  async function rejectsWhileHeld(holderSql,waiterSql=call()){
    const holder=session('planning-qa-holder');holder.send(`begin;${actor}${holderSql};select '__PLAN_HELD__';`);
    await waitForMarker(holder,'__PLAN_HELD__');
    const result=await finish(session('planning-qa-waiter'),`begin;${waiterSql};commit;`,false);
    assert.notEqual(result.code,0,'Expected conflict while rows are held');assert.match(result.error,/40001/);
    await finish(holder,'commit;');
    return result;
  }
  const tests=[
    ['planning identical requests wait on the same key and create one complete route',async()=>{
      await seed();const replay=await contested(call(),call(),{driver:false});
      const trip=await query('select id from public.dispatch_trips;');assert.ok(replay.output.includes(trip));
      assert.equal(await counts(),'1,1,1,2,1,1,0,0');
      assert.equal(await query("select status||','||(actual_start_at is null) from public.dispatch_trips;"),'planned,true');
    }],
    ['planning changed payload using the same key waits then rejects without changing the first route',async()=>{
      await seed();const changed={...planningPayload(),route_name:'Different request'};
      const rejected=await contested(call(),call(changed),{driver:false,waiterSucceeds:false});
      assert.match(rejected.error,/22023.*dispatch_idempotency_mismatch/);
      assert.equal(await counts(),'1,1,1,2,1,1,0,0');
      assert.equal(await query('select notes from public.dispatch_trips;'),'QA route');
    }],
    ['planning different keys conflict on the same load then reject a duplicate dispatch after commit',async()=>{
      await seed();const second={...planningPayload(),idempotency_key:'other-request'};
      await rejectsWhileHeld(call(),call(second));
      await assert.rejects(()=>query(call(second)+';'),/23514.*load_not_eligible_for_dispatch/);
      assert.equal(await counts(),'1,1,1,2,1,1,0,0');
    }],
    ...[
      ['load',`select id from public.loads where id=${q(i.load)} for update`],
      ['item',`select id from public.load_items where id=${q(i.item)} for update`],
      ['document',`select id from public.fiscal_documents where id=${q(i.doc)} for update`],
      ['vehicle',`select id from public.vehicles where id=${q(i.vehicle)} for update`],
      ['driver',`select id from public.drivers where id=${q(i.driver)} for update`],
      ['client',`select id from public.clients where id=${q(i.client)} for update`],
      ['membership',`select user_id from public.tenant_memberships where user_id=${q(i.operator)} for update`],
    ].map(([name,lock])=>[`planning a held ${name} fails promptly, rolls back fully and can retry the same request`,async()=>{
      await seed();await rejectsWhileHeld(lock);assert.equal(await counts(),'0,0,0,0,0,0,0,0');
      await query(call()+';');assert.equal(await counts(),'1,1,1,2,1,1,0,0');
    }]),
    ['planning draft contention leaves neither a partial route nor a dispatched draft',async()=>{
      await seed();const payload={...planningPayload(),planning_draft_id:i.draft};
      await rejectsWhileHeld(`select id from public.route_planning_drafts where id=${q(i.draft)} for update`,call(payload));
      assert.equal(await counts(),'0,0,0,0,0,0,0,0');assert.equal(await query('select status from public.route_planning_drafts;'),'draft');
      await query(call(payload)+';');assert.equal(await query('select status from public.route_planning_drafts;'),'dispatched');
    }],
    ['planning replay rechecks membership revoked while waiting on the idempotency lock',async()=>{
      await seed();await query(call()+';');
      const key=`dispatch_planned_route:${i.operator}:${i.request}`;
      const lock=`select pg_advisory_xact_lock(hashtext('dispatch_planned_route'),hashtext(${q(i.tenant+':'+key)}))`;
      const rejected=await contested(lock,call(),{driver:false,waiterSucceeds:false,
        holderAfterBlocked:`update public.tenant_memberships set active=false where user_id=${q(i.operator)}`});
      assert.match(rejected.error,/42501.*not_authorized/);assert.equal(await counts(),'1,1,1,2,1,1,0,0');
    }],
    ['planning rolled-back transaction leaves no result key and retry creates one route',async()=>{
      await seed();await query(`begin;${call()};rollback;`);assert.equal(await counts(),'0,0,0,0,0,0,0,0');
      await query(call()+';');assert.equal(await counts(),'1,1,1,2,1,1,0,0');
    }],
  ];
  for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}
  return tests.length;
}
