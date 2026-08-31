// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTripLoadDatabase } from './helpers/tripLoadDatabase';

// Real PostgreSQL with the production mirror trigger and minimal table fixtures.
// This does not replace full-stack Supabase RLS or multi-session concurrency tests.
const tenant = '20000000-0000-4000-8000-000000000001';
const otherTenant = '20000000-0000-4000-8000-000000000002';
const user = '10000000-0000-4000-8000-000000000003';
const driver = '60000000-0000-4000-8000-000000000001';
const trip = '80000000-0000-4000-8000-000000000001';
const otherTrip = '80000000-0000-4000-8000-000000000002';
const load = '81000000-0000-4000-8000-000000000001';
const otherLoad = '81000000-0000-4000-8000-000000000002';
let db: PGlite;

async function start() {
  await db.exec('set role authenticated');
  try { return await db.query('select public.driver_start_trip($1::uuid) as result', [trip]); }
  finally { await db.exec('reset role'); }
}
const transition = (to: string | null) => db.query(
  'select public.transition_load_status_v1($1::uuid,$2::uuid,$3::text)', [tenant, load, to],
);
const getState = async () => (await db.query<{ status: string; actual_start_at: string | null; load_status: string }>(
  `select t.status,t.actual_start_at,l.status as load_status from dispatch_trips t
    join loads l on l.trip_id=t.id where l.id=$1`, [load],
)).rows[0];

beforeAll(async () => {
  db=await createTripLoadDatabase();
}, 30000);

beforeEach(async () => {
  await db.exec('reset role; truncate dispatch_events,dispatch_trip_loads,loads,dispatch_trips,drivers,load_status_history');
  await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub', user]);
  await db.query('select set_config($1,$2,false)', ['test.operator', 'true']);
  await db.query('insert into drivers values ($1,$2,$3,true)', [driver,tenant,user]);
  await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values ($1,$2,$3,'planned')", [trip,tenant,driver]);
  await db.query("insert into loads(id,tenant_id,status) values ($1,$2,'ready')", [load,tenant]);
  await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values ($1,$2,$3)', [tenant,trip,load]);
});
afterAll(async () => { await db?.close(); });

describe('trip/load invariants executed by PostgreSQL', () => {
  it('starts trip and assigned loads atomically as the authenticated driver', async () => {
    await start();
    expect(await getState()).toMatchObject({ status: 'in_transit', load_status: 'in_transit' });
    expect((await getState()).actual_start_at).not.toBeNull();
  });
  it('repeated start preserves the timestamp and emits only one event', async () => {
    await start();
    const before = await getState();
    await start();
    expect(await getState()).toEqual(before);
    expect((await db.query('select count(*)::int as count from dispatch_events')).rows).toEqual([{ count: 1 }]);
  });
  it('rolls back every write when a linked load is on hold', async () => {
    await db.query('update loads set on_hold=true where id=$1', [load]);
    await expect(start()).rejects.toMatchObject({ code: '23514' });
    expect(await getState()).toMatchObject({ status: 'planned', actual_start_at: null, load_status: 'ready' });
    expect((await db.query('select count(*)::int as count from dispatch_events')).rows).toEqual([{ count: 0 }]);
  });
  it.each(['delivered','cancelled','returned','refused','partial_delivery','failed'])('preserves terminal load status %s', async status => {
    await db.query('update loads set status=$1 where id=$2', [status,load]);
    await start();
    expect((await getState()).load_status).toBe(status);
  });
  it('rejects anonymous users and a foreign driver without writing', async () => {
    for (const subject of ['', '10000000-0000-4000-8000-000000000099']) {
      await db.query('select set_config($1,$2,false)', ['request.jwt.claim.sub',subject]);
      await expect(start()).rejects.toMatchObject({ code: '42501' });
    }
    expect((await getState()).status).toBe('planned');
  });
  it.each(['completed','cancelled','invalid'])('rejects starting a %s trip', async status => {
    await db.query('update dispatch_trips set status=$1', [status]);
    await expect(start()).rejects.toMatchObject({ code: '23514' });
  });
  it('blocks a foreign-tenant linked load before any departure write', async () => {
    await db.query("insert into loads(id,tenant_id,status) values ($1,$2,'ready')", [otherLoad,otherTenant]);
    await expect(db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values ($1,$2,$3)', [tenant,trip,otherLoad]))
      .rejects.toMatchObject({code:'23514'});
    expect((await getState()).status).toBe('planned');
  });
  it('blocks an ordinary load update before the trip starts', async () => {
    await expect(db.query("update loads set status='in_transit' where id=$1", [load])).rejects.toMatchObject({ code: '23514' });
    expect((await getState()).load_status).toBe('ready');
  });
  it('blocks the operational transition RPC before the trip starts', async () => {
    await expect(transition('in_transit')).rejects.toMatchObject({ code: '23514' });
    expect((await getState()).load_status).toBe('ready');
  });
  it('rejects null status and a missing operator permission', async () => {
    await expect(transition(null)).rejects.toThrow('invalid_load_status_transition');
    await db.query('select set_config($1,$2,false)', ['test.operator','false']);
    await expect(transition('loading')).rejects.toThrow('not_authorized');
  });
  it('records a valid operational transition with its actor', async () => {
    await transition('loading');
    expect((await db.query('select old_value,new_value,created_by from load_status_history')).rows).toEqual([
      { old_value: 'ready', new_value: 'loading', created_by: user },
    ]);
  });
  it.each(["status='completed'", "status='cancelled'", "status='planned'", 'actual_start_at=null'])('blocks trip-only change %s while a load remains in transit', async assignment => {
    await start();
    await expect(db.exec(`update dispatch_trips set ${assignment}`)).rejects.toMatchObject({ code: '23514' });
    expect((await getState()).status).toBe('in_transit');
    expect((await getState()).actual_start_at).not.toBeNull();
  });
  it('allows trip then load completion in one transaction', async () => {
    await start();
    await db.exec(`begin;
      update dispatch_trips set status='completed',actual_end_at=now();
      update loads set status='delivered';
      commit;`);
    expect(await getState()).toMatchObject({ status: 'completed', load_status: 'delivered' });
  });
  it('rejects deleting the last link of an in-transit load through the existing mirror trigger', async () => {
    await start();
    await expect(db.exec('delete from dispatch_trip_loads')).rejects.toMatchObject({ code: '23514' });
    expect((await getState()).status).toBe('in_transit');
  });
  it('does not use another active trip to mask a planned primary trip', async () => {
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status,actual_start_at) values ($1,$2,$3,'in_transit',now())", [otherTrip,tenant,driver]);
    // Privileged fixture of an already-corrupt legacy assignment. New writes
    // are rejected by the link guard before this state can be introduced.
    await db.exec('set session_replication_role=replica');
    await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values ($1,$2,$3)', [tenant,otherTrip,load]);
    await db.exec('set session_replication_role=origin');
    await expect(transition('in_transit')).rejects.toMatchObject({ code: '23514' });
    expect((await getState()).status).toBe('planned');
  });
  it('does not manufacture a missing start timestamp for a legacy in-transit trip', async () => {
    // Fixture-only privileged setup of the inconsistency that predates these constraints.
    await db.exec("set session_replication_role=replica; update dispatch_trips set status='in_transit'; set session_replication_role=origin;");
    await expect(start()).rejects.toThrow('trip_start_requires_reconciliation');
    expect((await getState()).actual_start_at).toBeNull();
  });
  it('does not start now to conceal a historical in-transit load on a planned trip', async () => {
    await db.exec("set session_replication_role=replica; update loads set status='in_transit'; set session_replication_role=origin;");
    await expect(start()).rejects.toThrow('trip_start_requires_reconciliation');
    expect(await getState()).toMatchObject({ status: 'planned', actual_start_at: null, load_status: 'in_transit' });
    await expect(transition('in_transit')).rejects.toMatchObject({ code: '23514' });
  });
  it('rejects changing a canonical link even if a stale primary mirror still points at a started trip', async () => {
    await start();
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values ($1,$2,$3,'planned')", [otherTrip,tenant,driver]);
    await expect(db.query('update dispatch_trip_loads set dispatch_trip_id=$1 where load_id=$2', [otherTrip,load])).rejects.toMatchObject({ code: '23514' });
    expect((await getState()).status).toBe('in_transit');
  });
  it('does not start a legacy primary load without a canonical relation', async () => {
    await db.exec('delete from dispatch_trip_loads');
    await db.query('update dispatch_trips set load_id=$1 where id=$2', [load,trip]);
    await expect(start()).rejects.toThrow('trip_load_assignment_mismatch');
  });
  it('keeps internal validation helpers unavailable to client roles', async () => {
    const { rows } = await db.query(`select has_function_privilege('authenticated',
      'public._assert_load_transit_graph(uuid)','EXECUTE') as client,
      has_function_privilege('anon','public.driver_start_trip(uuid)','EXECUTE') as anonymous,
      has_function_privilege('service_role','public.transition_load_status_v1(uuid,uuid,text,text)','EXECUTE') as service_load_transition`);
    expect(rows).toEqual([{ client: false, anonymous: false, service_load_transition: false }]);
  });
  it('rejects a second active assignment before changing either mirror',async()=>{
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values($1,$2,$3,'planned')",[otherTrip,tenant,driver]);
    await expect(db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[tenant,otherTrip,load]))
      .rejects.toMatchObject({code:'23514'});
    expect((await db.query('select trip_id from loads where id=$1',[load])).rows).toEqual([{trip_id:trip}]);
  });
  it.each([null,otherTenant])('rejects a link tenant changed to %s without partial mirrors',async linkTenant=>{
    await expect(db.query('update dispatch_trip_loads set tenant_id=$1',[linkTenant])).rejects.toMatchObject({code:'23514'});
    expect((await db.query('select tenant_id from dispatch_trip_loads')).rows).toEqual([{tenant_id:tenant}]);
  });
  it('updates both trip mirrors when a planned canonical link moves',async()=>{
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status) values($1,$2,$3,'planned')",[otherTrip,tenant,driver]);
    await db.query('update dispatch_trip_loads set dispatch_trip_id=$1',[otherTrip]);
    expect((await db.query('select id,load_id from dispatch_trips order by id')).rows).toEqual([{id:trip,load_id:null},{id:otherTrip,load_id:load}]);
    expect((await db.query('select trip_id from loads where id=$1',[load])).rows).toEqual([{trip_id:otherTrip}]);
  });
  it('updates load mirrors when an existing link switches to another load',async()=>{
    await db.query("insert into loads(id,tenant_id,status) values($1,$2,'ready')",[otherLoad,tenant]);
    await db.query('update dispatch_trip_loads set load_id=$1',[otherLoad]);
    expect((await db.query('select id,trip_id from loads order by id')).rows).toEqual([{id:load,trip_id:null},{id:otherLoad,trip_id:trip}]);
    expect((await db.query('select load_id from dispatch_trips where id=$1',[trip])).rows).toEqual([{load_id:otherLoad}]);
  });
  it('preserves a representative remaining load instead of clearing the trip mirror',async()=>{
    await db.query("insert into loads(id,tenant_id,status) values($1,$2,'ready')",[otherLoad,tenant]);
    await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[tenant,trip,otherLoad]);
    await db.query('delete from dispatch_trip_loads where load_id=$1',[load]);
    expect((await db.query('select load_id from dispatch_trips where id=$1',[trip])).rows).toEqual([{load_id:otherLoad}]);
  });
  it('allows atomic detach/reattach to a started trip but still rejects a detached commit',async()=>{
    await start();
    await db.query("insert into dispatch_trips(id,tenant_id,driver_id,status,actual_start_at) values($1,$2,$3,'in_transit',now())",[otherTrip,tenant,driver]);
    await db.exec('begin');await db.query('delete from dispatch_trip_loads where load_id=$1',[load]);
    await db.query('insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) values($1,$2,$3)',[tenant,otherTrip,load]);
    await db.query("update dispatch_trips set status='cancelled',actual_end_at=now() where id=$1",[trip]);await db.exec('commit');
    expect((await db.query('select trip_id,status from loads where id=$1',[load])).rows).toEqual([{trip_id:otherTrip,status:'in_transit'}]);
    await expect(db.exec('delete from dispatch_trip_loads')).rejects.toMatchObject({code:'23514'});
    expect((await db.query('select count(*)::int count from dispatch_trip_loads')).rows).toEqual([{count:1}]);
  });
});
