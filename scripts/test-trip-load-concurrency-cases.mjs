import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { installDeliveryFinancialFixture } from '../src/test/helpers/deliveryFinancialDatabase.ts';
import { legacyTripLoadSchema,tripLoadCandidateSql,tripLoadRolloutContracts } from '../src/test/helpers/tripLoadDatabase.ts';

// Called only inside the loopback, disposable PostgreSQL harness. The real mirror,
// allocation and settlement triggers participate; external branches are instrumented.
export async function runTripLoadConcurrency(ctx){
  const {query,session,finish,waitForMarker,contested,literal:q,ids:i,identity,graph}=ctx;
  await installDeliveryFinancialFixture({exec:query});
  await query(`alter table public.loads add column on_hold boolean default false;
    create table public.load_status_history(tenant_id uuid,load_id uuid,field_name text,old_value text,new_value text,reason text,created_by uuid);
    create function public.current_driver_id(uuid) returns uuid language sql stable as $$
      select id from public.drivers where tenant_id=$1 and user_id=auth.uid() and active$$;
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$
      select $1=${q(i.tenant)}::uuid and auth.uid()=${q(i.user)}::uuid$$;
  `+readFileSync('docs/qa/TRIP-LOAD-TRIGGERS-2026-08-30.sql','utf8')+`
    create trigger trg_sync_trip_load_mirrors after insert or delete on public.dispatch_trip_loads
      for each row execute function public.sync_trip_load_mirrors();
    create trigger trg_check_load_dispatch_duplicity before insert on public.dispatch_trip_loads
      for each row execute function public.check_load_dispatch_duplicity();
    create trigger trg_dispatch_trip_loads_outdate after insert or update or delete on public.dispatch_trip_loads
      for each row execute function public._tg_mark_outdated_trip_loads();
  `);
  await query(legacyTripLoadSchema+'begin;'+readFileSync('supabase/migrations/20260831230903_enforce_trip_load_transit_invariant.sql','utf8')+'commit;');
  const start=`select public.driver_start_trip(${q(i.trip)})`;
  const tripLock=`select id from public.dispatch_trips where id=${q(i.trip)} for update`;
  const transition=`select public.transition_load_status_v1(${q(i.tenant)},${q(i.load)},'in_transit',null)`;
  const unlink=`delete from public.dispatch_trip_loads where dispatch_trip_id=${q(i.trip)}`;
  async function seed(planned=false){
    await query('truncate public.driver_settlement_items,public.driver_settlement_events,public.driver_settlement_payments,public.driver_settlements,public.driver_expenses,public.trip_routes,public.load_status_history,public.qa_delivery_side_effects;');
    await ctx.seed();
    if(planned)await query(`begin;update public.loads set status='ready';update public.dispatch_trips set status='planned',actual_start_at=null;commit;`);
  }
  async function rejectedWhileTripHeld(sql){
    const holder=session('trip-load-qa-holder');holder.send(`begin;${identity}${tripLock};select '__TRIP_HELD__';`);
    await waitForMarker(holder,'__TRIP_HELD__');
    const waiter=session('trip-load-qa-waiter');
    const result=await finish(waiter,`begin;${identity}${sql};commit;`,false);
    assert.notEqual(result.code,0,'Expected retryable conflict');assert.match(result.error,/40001/);
    await finish(holder,`${graph};commit;`);
  }
  const recovery=readFileSync('docs/qa/TRIP-LOAD-RECOVERY-2026-08-30.sql','utf8');
  const businessTables=['loads','dispatch_trips','dispatch_trip_loads','dispatch_stops','fiscal_documents',
    'proof_of_delivery','operational_events','dispatch_events','load_status_history','driver_settlements',
    'driver_settlement_items','driver_settlement_events','driver_settlement_payments','qa_delivery_side_effects'];
  const businessSnapshot=()=>query(`select jsonb_build_object(${businessTables.map(table=>
    `${q(table)},(select jsonb_agg(to_jsonb(r) order by to_jsonb(r)::text) from public.${table} r)`).join(',')});`);
  const contractSnapshot=()=>query(`select jsonb_agg(jsonb_build_object('signature',p.oid::regprocedure::text,
    'hash',md5(replace(pg_get_functiondef(p.oid),E'\\r\\n',E'\\n')),'acl',p.proacl::text) order by p.proname)
    from pg_proc p where p.oid in('public.driver_start_trip(uuid)'::regprocedure,
    'public.transition_load_status_v1(uuid,uuid,text,text)'::regprocedure,'public.sync_trip_load_mirrors()'::regprocedure,
    'public._tg_mark_outdated_trip_loads()'::regprocedure);`);
  const tests=[
    ['operational load transition takes trip before load and does not deadlock with delivery',async()=>{
      await seed();await contested(tripLock,transition,{driver:false,holderAfterBlocked:graph});
      assert.equal(await query('select status from public.loads;'),'in_transit');
    }],
    ['link deletion conflicting with delivery rejects for retry without retaining child locks',async()=>{
      // A ready load is unlinkable: the test must exercise lock safety, not just
      // the invariant that already forbids orphaning an in-transit load.
      await seed(true);await rejectedWhileTripHeld(unlink);
      assert.equal(await query('select count(*) from public.dispatch_trip_loads;'),'1');
    }],
    ['direct load write detects a held trip without forming a commit-time deadlock',async()=>{
      await seed();await rejectedWhileTripHeld(`update public.loads set status='in_transit' where id=${q(i.load)}`);
      assert.equal(await query('select status from public.loads;'),'in_transit');
    }],
    ['two starts serialize and preserve one departure event and timestamp',async()=>{
      await seed(true);const replay=await contested(start,start);
      assert.ok(replay.output.includes('"changed": false'));
      assert.equal(await query("select count(*) from public.dispatch_events where event_type='trip_started';"),'1');
      assert.equal(await query('select (status=\'in_transit\' and actual_start_at is not null) from public.dispatch_trips;'),'t');
    }],
    ['hold committed while start waits prevents any partial departure',async()=>{
      await seed(true);const result=await contested(`update public.loads set on_hold=true where id=${q(i.load)}`,start,
        {driver:false,waiterSucceeds:false});
      assert.match(result.error,/23514/);
      assert.equal(await query('select status from public.dispatch_trips;'),'planned');
      assert.equal(await query("select count(*) from public.dispatch_events where event_type='trip_started';"),'0');
    }],
    ['start revalidates driver assignment after waiting',async()=>{
      await seed(true);const other='60000000-0000-4000-8000-000000000099';
      await query(`insert into public.drivers values(${q(other)},${q(i.tenant)},'10000000-0000-4000-8000-000000000099',true);`);
      const result=await contested(tripLock,start,{driver:false,waiterSucceeds:false,
        holderAfterBlocked:`update public.dispatch_trips set driver_id=${q(other)} where id=${q(i.trip)}`});
      assert.match(result.error,/42501/);assert.equal(await query('select status from public.loads;'),'ready');
    }],
    ['unlink waiting on a started graph cannot commit an orphan in-transit load',async()=>{
      await seed(true);const result=await contested(start,unlink,{driver:false,waiterSucceeds:false});
      assert.match(result.error,/23514/);assert.equal(await query('select count(*) from public.dispatch_trip_loads;'),'1');
    }],
    ['two allocations of the same load cannot create two active trips',async()=>{
      await seed(true);await query(unlink+';');const other='80000000-0000-4000-8000-000000000002';
      await query(`insert into public.dispatch_trips(id,tenant_id,driver_id,status) values(${q(other)},${q(i.tenant)},${q(i.driver)},'planned');`);
      const link=trip=>`insert into public.dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values(${q(i.tenant)},${q(trip)},${q(i.load)})`;
      const holder=session('trip-allocation-holder');holder.send(`begin;${identity}${link(i.trip)};select '__ALLOCATED__';`);
      await waitForMarker(holder,'__ALLOCATED__');
      const rejected=await finish(session('trip-allocation-waiter'),`begin;${identity}${link(other)};commit;`,false);
      assert.match(rejected.error,/40001/);await finish(holder,'commit;');
      await assert.rejects(()=>query(link(other)+';'),/23514/);
      assert.equal(await query('select count(*) from public.dispatch_trip_loads;'),'1');
      assert.equal(await query('select trip_id from public.loads;'),i.trip);
    }],
    ['failed trip-only completion rolls back the automatic financial settlement',async()=>{
      await seed();await assert.rejects(()=>query("begin;update public.dispatch_trips set status='completed',actual_end_at=now();commit;"),/23514/);
      assert.equal(await query('select status from public.dispatch_trips;'),'in_transit');
      assert.equal(await query('select count(*) from public.driver_settlements;'),'0');
      assert.equal(await query('select count(*) from public.driver_settlement_events;'),'0');
    }],
    ['delivery result and settlement remain consistent when an operational transition waits',async()=>{
      await seed();const resultSql=`select public.driver_record_delivery_outcome(${q(i.stop)},'failed','{"notes":"QA sem entrega"}',${q(i.request)},'arrived')`;
      const rejected=await contested(resultSql,transition,{driver:false,waiterSucceeds:false});
      assert.match(rejected.error,/invalid_load_status_transition/);
      assert.equal(await query('select status from public.loads;'),'failed');
      assert.equal(await query('select status from public.dispatch_trips;'),'completed');
      assert.equal(await query("select status||','||needs_recalculation from public.driver_settlements;"),'pending_review,false');
      assert.equal(await query('select count(*) from public.driver_settlement_payments;'),'0');
    }],
    ['recovery refuses a drifted candidate and rolls back without changing financial evidence',async()=>{
      const before=await businessSnapshot();const contracts=await contractSnapshot();
      await assert.rejects(()=>query('begin;alter function public.driver_start_trip(uuid) set search_path=public;'+recovery),
        /recovery refused: unknown function/);
      assert.equal(await businessSnapshot(),before);assert.equal(await contractSnapshot(),contracts);
    }],
    ['recovery restores captured contracts and reapplication preserves delivery and pending settlement',async()=>{
      const before=await businessSnapshot();
      assert.equal(await query('select count(*) from public.driver_settlements;'),'1');
      const started=performance.now();await query(recovery);
      for(const contract of tripLoadRolloutContracts.functions){
        const actual=JSON.parse(await query(`select json_build_object(
          'hash',md5(replace(pg_get_functiondef(${q('public.'+contract.signature)}::regprocedure),E'\\r\\n',E'\\n')),
          'anon',has_function_privilege('anon',${q('public.'+contract.signature)},'execute'),
          'authenticated',has_function_privilege('authenticated',${q('public.'+contract.signature)},'execute'),
          'service_role',has_function_privilege('service_role',${q('public.'+contract.signature)},'execute'));`));
        assert.deepEqual(actual,{hash:contract.hash,anon:contract.anon,authenticated:contract.authenticated,service_role:contract.service_role});
      }
      assert.equal(await query("select to_regprocedure('public._assert_load_transit_graph(uuid)') is null;"),'t');
      assert.equal(await businessSnapshot(),before);
      await query('begin;'+tripLoadCandidateSql+'commit;');assert.equal(await businessSnapshot(),before);
      console.log(`Recovery + verification + reapplication: ${Math.round(performance.now()-started)} ms (local fixture)`);
    }],
  ];
  for(const [name,test] of tests){await test();console.log(`PASS ${name}`);}
  return tests.length;
}
