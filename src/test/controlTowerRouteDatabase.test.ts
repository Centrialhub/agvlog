// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {controlTowerDatabase,seedTower,towerIds as i,towerActor,towerRead} from './helpers/controlTowerDatabase';
let db:PGlite;const req='90000000-0000-4000-8000-000000000001',attempt='91000000-0000-4000-8000-000000000001';
const route={geometry:{type:'LineString',coordinates:[[-46.1,-23.1],[-46,-23]]},distance_meters:15000,duration_seconds:900,waypoints:[{location:[-46.1,-23.1]},{location:[-46,-23]}]};
beforeAll(async()=>{db=await controlTowerDatabase();await seedTower(db);},20000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await db.query("insert into positions_last(tenant_id,vehicle_id,lat,lng,captured_at,received_at) values($1,$2,-23.1,-46.1,now()-interval '1 minute',now())",[i.tenant,i.vehicle]);});
afterEach(async()=>{await db.exec('rollback');});
async function rpc(name:string,args:unknown[]){
 await db.exec('savepoint route_call;set local role authenticated');
 try{const value=(await db.query<{v:Record<string,unknown>}>(`select public.${name}(${args.map((_,n)=>'$'+(n+1)).join(',')}) v`,args)).rows[0].v;await db.exec('reset role;release route_call');return value;}
 catch(error){await db.exec('rollback to route_call;release route_call');throw error;}
}
const prepare=(request=req,tenant=i.tenant)=>rpc('prepare_trip_route_v1',[tenant,i.trip,request,attempt]);
const commit=(payload:unknown=route,request=req)=>rpc('commit_trip_route_v1',[i.tenant,i.trip,request,attempt,payload]);
describe('routing transactions and replay',()=>{
 it('confirms replay without changing a newer route',async()=>{
  await prepare();const first=await commit();expect(await commit()).toEqual(first);
  const next=crypto.randomUUID();await prepare(next);const second=await commit({...route,duration_seconds:950},next);
  expect((await prepare()).result).toEqual(first);expect(await commit()).toEqual(first);
  expect((await db.query('select duration_seconds::double precision duration_seconds from trip_routes')).rows).toEqual([{duration_seconds:950}]);expect(second.request_id).toBe(next);
 });
 it('denies changed payload for an already committed identity',async()=>{
  await prepare();await commit();await expect(commit({...route,duration_seconds:20})).rejects.toThrow(/payload changed/);
 });
 it('holds a lease for the same request and rejects an obsolete attempt',async()=>{
  await prepare();await expect(prepare()).rejects.toThrow(/andamento/);
  await db.exec("update control_tower_private.route_calculations set lease_until=now()-interval '1 second'");
  await rpc('prepare_trip_route_v1',[i.tenant,i.trip,req,crypto.randomUUID()]);await expect(commit()).rejects.toThrow(/contexto mudou/);
 });
 it.each(['expired','position','stop','new_stop','vehicle','finished'])('rejects %s context before committing',async kind=>{
  await prepare();
  if(kind==='expired')await db.exec("update control_tower_private.route_calculations set lease_until=now()-interval '1 second'");
  if(kind==='position')await db.exec('update positions_last set lat=-24');
  if(kind==='stop')await db.exec('update dispatch_stops set longitude=-45');
  if(kind==='new_stop')await db.query("insert into dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,status,latitude,longitude) values($1,$2,2,'QA','pending',-23,-46)",[i.tenant,i.trip]);
  if(kind==='vehicle')await db.exec('update dispatch_trips set vehicle_id=null');
  if(kind==='finished')await db.exec("update dispatch_trips set status='completed'");
  await expect(commit()).rejects.toThrow(/contexto mudou/);expect((await db.query('select * from trip_routes')).rows).toEqual([]);
 });
 it.each(['driver','client','owner','admin'])('rejects %s AAL1, including direct private entry calls',async role=>{
  await db.query('update tenant_memberships set role=$1',[role]);await expect(prepare()).rejects.toThrow(/Forbidden|MFA/);
  await db.exec('savepoint private_call;set local role authenticated');
  await expect(db.query('select control_tower_private.prepare_route($1,$2,$3,$4)',[i.tenant,i.trip,req,attempt])).rejects.toThrow(/Forbidden|MFA/);
  await db.exec('rollback to private_call;release private_call');
 });
 it('allows privileged AAL2 and denies another tenant',async()=>{
  await db.exec("update tenant_memberships set role='admin'");await towerActor(db,'aal2');await expect(prepare(i.stop,i.other)).rejects.toThrow(/Forbidden/);await prepare();expect((await commit()).ok).toBe(true);
 });
 it('rechecks membership and MFA at commit and before replay',async()=>{
  await prepare();await db.exec("update tenant_memberships set role='admin'");await expect(commit()).rejects.toThrow(/MFA/);
  await towerActor(db,'aal2');await commit();await db.exec('update tenant_memberships set active=false');await expect(prepare()).rejects.toThrow(/Forbidden/);
 });
 it('rolls back the route if its durable receipt fails',async()=>{
  await prepare();await db.exec(`create function qa_fail_receipt() returns trigger language plpgsql as $$begin raise exception 'QA receipt failure';end$$;
  create trigger qa_fail_receipt before update on control_tower_private.route_calculations for each row execute function qa_fail_receipt();`);
  await expect(commit()).rejects.toThrow(/QA receipt/);expect((await db.query('select * from trip_routes')).rows).toEqual([]);
  expect((await db.query('select result from control_tower_private.route_calculations')).rows).toEqual([{result:null}]);
 });
 it('keeps the real financial invalidation and audit atomic, without duplicate replay events',async()=>{
  await db.query("insert into driver_settlements(tenant_id,dispatch_trip_id,status,needs_recalculation,driver_payable_amount) values($1,$2,'pending_review',false,123)",[i.tenant,i.trip]);
  await prepare();await commit();await commit();
  expect((await db.query('select needs_recalculation,recalculation_reason,driver_payable_amount::double precision amount from driver_settlements')).rows).toEqual([{needs_recalculation:true,recalculation_reason:'trip_route_change',amount:123}]);
  expect((await db.query('select event_type,created_by from driver_settlement_events')).rows).toEqual([{event_type:'marked_outdated',created_by:i.actor}]);
 });
 it('rolls back route and receipt when the actual financial audit cannot be written',async()=>{
  await db.query("insert into driver_settlements(tenant_id,dispatch_trip_id,status,needs_recalculation) values($1,$2,'pending_review',false)",[i.tenant,i.trip]);await prepare();
  await db.exec(`create function qa_fail_finance() returns trigger language plpgsql as $$begin raise exception 'QA finance failure';end$$;
  create trigger qa_fail_finance before insert on driver_settlement_events for each row execute function qa_fail_finance();`);
  await expect(commit()).rejects.toThrow(/QA finance/);expect((await db.query('select * from trip_routes')).rows).toEqual([]);
  expect((await db.query('select needs_recalculation from driver_settlements')).rows).toEqual([{needs_recalculation:false}]);
  expect((await db.query('select result from control_tower_private.route_calculations')).rows).toEqual([{result:null}]);
 });
 it('excludes completed stops; planned travel can use its first pending stop as origin',async()=>{
  await db.exec("update dispatch_trips set status='planned';delete from positions_last");
  await db.query("insert into dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,status,latitude,longitude) values($1,$2,2,'QA','pending',-23.1,-46.1),($1,$2,3,'Feita','completed',null,null)",[i.tenant,i.trip]);
  expect((await prepare()).coordinates).toEqual([{lat:-23,lng:-46},{lat:-23.1,lng:-46.1}]);
 });
 it('hides an old plan without invalidating a valid route on every new position',async()=>{
  await prepare();await commit();await db.exec('update positions_last set lat=-23.2');
  expect((await towerRead<Record<string,unknown>[]>(db))[0].route_geometry_geojson).toEqual(route.geometry);
  await db.exec('update dispatch_stops set longitude=-45');expect((await towerRead<Record<string,unknown>[]>(db))[0].route_geometry_geojson).toBeNull();
 });
 it('preserves full planned mileage when the navigation route is recalculated in transit',async()=>{
  await db.exec("update dispatch_trips set status='planned',actual_start_at=null");await prepare();await commit();
  await db.exec("update dispatch_trips set status='in_transit',actual_start_at=clock_timestamp();update positions_last set lat=-23.05,lng=-46.05,captured_at=clock_timestamp()");
  const next=crypto.randomUUID();await prepare(next);await commit({...route,geometry:{type:'LineString',coordinates:[[-46.05,-23.05],[-46,-23]]},waypoints:[{location:[-46.05,-23.05]},{location:[-46,-23]}],distance_meters:7600,duration_seconds:450},next);
  expect((await db.query('select distance_meters::int current_distance,planned_distance_meters::int planned_distance from trip_routes')).rows).toEqual([{current_distance:7600,planned_distance:15000}]);
  await db.exec("update dispatch_stops set status='completed'");
  expect((await db.query<{km:string}>('select control_tower_private.settlement_route_km($1,$2) km',[i.tenant,i.trip])).rows[0].km).toBe('15.0000000000000000');
  await db.exec('update dispatch_stops set longitude=-45');expect((await db.query<{km:string|null}>('select control_tower_private.settlement_route_km($1,$2) km',[i.tenant,i.trip])).rows[0].km).toBeNull();
 });
 it('does not invent total trip mileage from an initial in-transit calculation',async()=>{
  await prepare();await commit();expect((await db.query('select planned_distance_meters from trip_routes')).rows).toEqual([{planned_distance_meters:null}]);
 });
 it.each([{...route,distance_meters:-1},{...route,distance_meters:1},{...route,waypoints:[]},{...route,geometry:{type:'Point',coordinates:[0,0]}},
  {...route,geometry:{type:'LineString',coordinates:[[200,0],[0,0]]}},{...route,geometry:{type:'LineString',coordinates:[[0,0],[1,1]]}}])('rejects malformed or mismatched provider data %#',async payload=>{
  await prepare();await expect(commit(payload)).rejects.toThrow();expect((await db.query('select * from trip_routes')).rows).toEqual([]);
 });
 it('keeps ledger/table writes and all public API execution closed to unintended roles',async()=>{
  for(const role of ['anon','service_role'])for(const fn of ['prepare_trip_route_v1(uuid,uuid,uuid,uuid)','commit_trip_route_v1(uuid,uuid,uuid,uuid,jsonb)']){
    expect((await db.query<{allowed:boolean}>('select has_function_privilege($1,$2,\'execute\') allowed',[role,fn])).rows[0].allowed).toBe(false);
  }
  expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','trip_routes','insert,update,delete') allowed")).rows[0].allowed).toBe(false);
  expect((await db.query<{allowed:boolean}>("select has_table_privilege('authenticated','control_tower_private.route_calculations','select,insert,update,delete') allowed")).rows[0].allowed).toBe(false);
 });
});
