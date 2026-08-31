// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {controlTowerDatabase,seedTower,towerActor,towerIds as i,towerRead} from './helpers/controlTowerDatabase';
import {pointToLineDistanceMeters} from '../../supabase/functions/_shared/geo';
let db:PGlite;
beforeAll(async()=>{db=await controlTowerDatabase();await seedTower(db);},20000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin;update tenant_feature_policy set enabled=true;');});
afterEach(async()=>{await db.exec('rollback');});
async function evaluate(tenant=i.tenant,trip=i.trip){
 await db.exec('savepoint evaluate;set local role authenticated');
 try{const result=await db.query<{value:{ok:boolean;state:string;evaluated:boolean;context_revision:string}}>('select evaluate_trip_live_status_v1($1,$2) value',[tenant,trip]);await db.exec('reset role;release evaluate');return result.rows[0].value;}
 catch(error){await db.exec('rollback to evaluate;release evaluate');throw error;}
}
async function position(lat=0,lng=0.5,speed:number|null=30){await db.query('insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values($1,$2,$3,$4,$5,statement_timestamp()-interval \'1 minute\',statement_timestamp())',[i.tenant,i.vehicle,lat,lng,speed]);}
async function route(){await db.query('insert into trip_routes(tenant_id,trip_id,provider,geometry_geojson,plan_revision) values($1,$2,\'osrm\',$3,control_tower_private.route_plan_revision($1,$2))',[i.tenant,i.trip,JSON.stringify({type:'LineString',coordinates:[[0,0],[1,0]]})]);}
const live=async()=>(await db.query<Record<string,unknown>>('select * from trip_live_status')).rows[0];
describe('server-calculated atomic tracking evaluation',()=>{
 it('has no writable client metrics and no direct table mutation grants',async()=>{
  const result=await db.query(`select has_table_privilege('authenticated','trip_alerts','INSERT') alerts,
   has_table_privilege('authenticated','trip_live_status','UPDATE') status,
   has_function_privilege('anon','evaluate_trip_live_status_v1(uuid,uuid)','EXECUTE') anon,
   has_function_privilege('service_role','evaluate_trip_live_status_v1(uuid,uuid)','EXECUTE') service,
   (select prosecdef from pg_proc where oid='evaluate_trip_live_status_v1(uuid,uuid)'::regprocedure) definer`);
  expect(result.rows).toEqual([{alerts:false,status:false,anon:false,service:false,definer:false}]);
 });
 it.each(['driver','client','admin','owner'])('rejects direct RPC bypass by %s at AAL1',async role=>{
  await db.query('update tenant_memberships set role=$1',[role]);await expect(evaluate()).rejects.toThrow(/Forbidden|MFA/);
  expect(await live()).toBeUndefined();
 });
 it('accepts AAL2 admin and rejects a missing actor and foreign tenant',async()=>{
  await db.exec("update tenant_memberships set role='admin'");await towerActor(db,'aal2');expect((await evaluate()).ok).toBe(true);
  await expect(evaluate(i.other)).rejects.toThrow(/Forbidden/);await db.exec("select set_config('request.jwt.claim.sub','',true)");await expect(evaluate()).rejects.toThrow(/Forbidden/);
 });
 it('denies the direct RPC with SSX off or its kill switch on',async()=>{
  await db.exec('update tenant_feature_policy set enabled=false');await expect(evaluate()).rejects.toThrow(/SSX disabled/);
  await db.exec('update tenant_feature_policy set enabled=true');await db.query("insert into tenant_feature_policy(tenant_id,feature_key,enabled) values($1,'ssx_kill_switch',true)",[i.tenant]);
  await expect(evaluate()).rejects.toThrow(/SSX disabled/);
 });
 it('does not evaluate a trip completed after the Edge inventory was read',async()=>{
  await db.exec("update dispatch_trips set status='completed'");expect(await evaluate()).toMatchObject({ok:true,evaluated:false});expect(await live()).toBeUndefined();
 });
 it('keeps one alert ID across replays and preserves manual occurrences',async()=>{
  await db.query("insert into trip_alerts(tenant_id,trip_id,type,severity,title) values($1,$2,'manual_occurrence','critical','Ajuda')",[i.tenant,i.trip]);
  await evaluate();const first=(await db.query("select id from trip_alerts where type='no_signal'")).rows;
  await evaluate();await evaluate();expect((await db.query("select id from trip_alerts where type='no_signal'")).rows).toEqual(first);
  expect((await db.query("select status,title from trip_alerts where type='manual_occurrence'")).rows).toEqual([{status:'open',title:'Ajuda'}]);
 });
 it('keeps acknowledged alerts and closes legacy duplicates with an audit link, not deletion',async()=>{
  await db.query("insert into trip_alerts(tenant_id,trip_id,type,severity,title,status) values($1,$2,'no_signal','danger','A','acknowledged'),($1,$2,'no_signal','danger','B','open')",[i.tenant,i.trip]);
  await evaluate();const alerts=(await db.query<{status:string;metadata:Record<string,string>}>('select status,metadata from trip_alerts')).rows;
  expect(alerts).toHaveLength(2);expect(alerts.filter(a=>a.status!=='closed')).toHaveLength(1);
  expect(alerts.find(a=>a.status==='closed')?.metadata.superseded_by).toBeTruthy();
 });
 it('rolls back status and closure of an old alert if opening the new alert fails',async()=>{
  await db.query("insert into trip_alerts(tenant_id,trip_id,type,severity,title) values($1,$2,'off_route','critical','Desvio')",[i.tenant,i.trip]);
  await db.exec("create function qa_fail_alert() returns trigger language plpgsql as $$begin raise exception 'QA fail';end$$;create trigger qa_fail_alert before insert on trip_alerts for each row execute function qa_fail_alert();");
  await expect(evaluate()).rejects.toThrow(/QA fail/);expect(await live()).toBeUndefined();
  expect((await db.query('select status from trip_alerts')).rows).toEqual([{status:'open'}]);
 });
 it('does not report off-route at a segment midpoint, but does for an actual deviation',async()=>{
  await position();await route();expect((await evaluate()).state).toBe('normal');expect(Number((await live()).distance_from_route_meters)).toBeLessThan(0.01);
  await db.exec('update positions_last set lat=0.02');expect((await evaluate()).state).toBe('off_route');
  expect(Number((await live()).distance_from_route_meters)).toBeGreaterThan(2200);
 });
 it('matches segment geometry in SQL and JS including high latitude and date line',async()=>{
  for(const [lat,lng,coordinates] of [[0.01,180,[[179,0],[-179,0]]],[80,1,[[0,80],[2,80]]],[0,2,[[0,0],[1,0]]]] as [number,number,[number,number][]][]){
   const line={type:'LineString' as const,coordinates};
   const result=await db.query<{d:number}>('select control_tower_private.route_distance_m($1,$2,$3) d',[lat,lng,JSON.stringify(line)]);
   expect(result.rows[0].d).toBeCloseTo(pointToLineDistanceMeters({lat,lng},line),5);
  }
 });
 it('rejects malformed route geometry without writing a false normal state',async()=>{
  await position();await route();await db.exec("update trip_routes set geometry_geojson='{}'");await expect(evaluate()).rejects.toThrow(/Invalid route/);expect(await live()).toBeUndefined();
 });
 it('hides stale automatic alerts after an operational change, preserving their audit row',async()=>{
  await position(0.02);await route();await evaluate();expect(await towerRead(db,'get_open_trip_alerts')).toMatchObject([{type:'off_route'}]);
  await db.exec("update dispatch_stops set status='arrived'");expect(await towerRead(db,'get_open_trip_alerts')).toEqual([]);
  expect((await db.query('select status from trip_alerts')).rows).toEqual([{status:'open'}]);
  await evaluate();expect(await towerRead(db,'get_open_trip_alerts')).toMatchObject([{type:'off_route'}]);
 });
 it('ignores a false stopped duration caused by absent observations and uses real history',async()=>{
  await position(0,0.5,0);expect((await evaluate()).state).toBe('normal');
  await db.query("insert into positions_raw(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) select tenant_id,vehicle_id,lat,lng,0,captured_at-interval '20 minutes',received_at from positions_last");
  expect((await evaluate()).state).toBe('stopped');expect(Number((await live()).stopped_minutes)).toBe(20);
 });
 it('unknown speed is not proof that a vehicle stopped',async()=>{
  await position(-23,-46,null);expect((await evaluate()).state).toBe('arriving');expect((await live()).stopped_minutes).toBeNull();
 });
 it('uses captured time for ETA so a repeated evaluation cannot postpone it',async()=>{
  await position();await evaluate();const eta=(await live()).eta_next_stop_at;await evaluate();expect((await live()).eta_next_stop_at).toEqual(eta);
 });
 it.each(['stop','route','position'])('invalidates reader metrics when %s changes without a new timestamp',async kind=>{
  await position();await route();await evaluate();expect((await towerRead<unknown[]>(db))[0]).toMatchObject({state:'normal'});
  if(kind==='stop')await db.exec("update dispatch_stops set status='arrived'");
  if(kind==='route')await db.exec("update trip_routes set geometry_geojson='{\"type\":\"LineString\",\"coordinates\":[[10,0],[11,0]]}'");
  if(kind==='position')await db.exec('update positions_last set lat=0.01');
  expect((await towerRead<unknown[]>(db))[0]).toMatchObject({state:'unknown',distance_from_route_meters:null});
  await evaluate();expect((await towerRead<{state:string}[]>(db))[0].state).not.toBe('unknown');
 });
});
