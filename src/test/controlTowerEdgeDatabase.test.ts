// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {controlTowerDatabase,seedTower,towerActor,towerFunction,towerIds as i,towerRead} from './helpers/controlTowerDatabase';
import {towerEdgeClient} from './helpers/controlTowerEdgeDatabase';
const state=vi.hoisted(()=>({client:vi.fn(),handlers:[] as ((r:Request)=>Promise<Response>)[],route:vi.fn()}));
vi.mock('@supabase/supabase-js',()=>({createClient:(...args:unknown[])=>state.client(...args)}));
vi.mock('../../supabase/functions/_shared/osrm.ts',()=>({calculateOsrmRoute:(...args:unknown[])=>state.route(...args)}));
let db:PGlite;
beforeAll(async()=>{
 db=await controlTowerDatabase();await seedTower(db);
 await db.exec(`grant select on tenant_memberships to authenticated;
   alter table tenant_memberships enable row level security;`);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 const membershipPolicy=baseline.match(/CREATE POLICY "Members can view memberships of their tenants"[\s\S]*?;/)?.[0];
 if(!membershipPolicy)throw new Error('Missing actual membership policy');await db.exec(membershipPolicy);
 const capability=readFileSync('supabase/migrations/20260829142707_restore_production_integration_capabilities.sql','utf8');
 await db.exec(towerFunction(capability,'assert_tenant_integration_capability_v1'));
 await db.exec('revoke all on function assert_tenant_integration_capability_v1(uuid,text) from public,anon,authenticated;grant execute on function assert_tenant_integration_capability_v1(uuid,text) to service_role');
 vi.stubGlobal('Deno',{env:{get:(k:string)=>({SUPABASE_URL:'https://db.example.test',SUPABASE_ANON_KEY:'anon-test',SUPABASE_SERVICE_ROLE_KEY:'service-test'}[k])},serve:(h:(r:Request)=>Promise<Response>)=>state.handlers.push(h)});
 const updatePath='../../supabase/functions/update-trip-live-status/index.ts',routePath='../../supabase/functions/calculate-trip-route/index.ts';
 await import(updatePath);await import(routePath);
},20000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 await db.exec('begin');state.client.mockReset().mockImplementation((_url:string,key:string)=>towerEdgeClient(db,key==='service-test'));
 state.route.mockReset().mockImplementation(async(coords:{lat:number;lng:number}[])=>({geometryGeoJson:{type:'LineString',coordinates:coords.map(c=>[c.lng,c.lat])},distanceMeters:15000,durationSeconds:900,waypoints:coords.map(c=>({location:[c.lng,c.lat]}))}));
 vi.stubGlobal('fetch',vi.fn(()=>{throw new Error('External request forbidden in QA');}));
});
afterEach(async()=>{await db.exec('rollback');});
const request=(n=0,body:Record<string,unknown>={tenant_id:i.tenant},method='POST')=>state.handlers[n](new Request('https://edge.example.test',{method,headers:{Authorization:'Bearer test'},...(method==='POST'?{body:JSON.stringify({...(n===1?{request_id:crypto.randomUUID(),actor_id:i.actor,tenant_id:i.tenant}:{}),...body})}:{})}));
async function position(age="interval '1 minute'",speed=30){await db.query(`insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values($1,$2,-23.1,-46.1,$3,now()-${age},now())`,[i.tenant,i.vehicle,speed]);}
describe('actual Edge handlers with caller-role SQL, no provider traffic',()=>{
 it('blocks SSX-disabled reevaluation before writing telemetry status',async()=>{
  expect((await request()).status).toBe(403);expect((await db.query('select * from trip_live_status')).rows).toEqual([]);expect(fetch).not.toHaveBeenCalled();
 });
 it.each(['driver','client','admin','owner'])('denies %s at AAL1',async role=>{
  await db.query('update tenant_memberships set role=$1',[role]);await db.exec('update tenant_feature_policy set enabled=true');
  expect((await request()).status).toBe(403);expect((await db.query('select * from trip_live_status')).rows).toEqual([]);
  expect([403,404]).toContain((await request(1,{trip_id:i.trip})).status);expect(state.route).not.toHaveBeenCalled();
 });
 it('processes in_transit, excludes planned, keeps manual alerts and exposes updated SQL data',async()=>{
  await db.exec('update tenant_feature_policy set enabled=true');await position();
  await db.query("insert into trip_alerts(tenant_id,trip_id,type,severity,title) values($1,$2,'manual_occurrence','critical','Ajuda')",[i.tenant,i.trip]);
  const response=await request();expect(await response.json()).toMatchObject({ok:true,processed:1,errors:[]});
  expect((await db.query('select trip_id,state from trip_live_status')).rows).toEqual([{trip_id:i.trip,state:'normal'}]);
  expect(await towerRead(db)).toMatchObject([{trip_id:i.trip,state:'normal'},{trip_id:i.planned,state:'planned'}]);
  expect(await towerRead(db,'get_open_trip_alerts')).toMatchObject([{title:'Ajuda',status:'open'}]);expect(fetch).not.toHaveBeenCalled();
 });
 it('never replaces no_signal by stopped based on stale stationary data',async()=>{
  await db.exec('update tenant_feature_policy set enabled=true');await position("interval '30 minutes'",0);
  expect((await request()).status).toBe(200);expect((await db.query('select state from trip_live_status')).rows).toEqual([{state:'no_signal'}]);
 });
 it('reports a denied write instead of success',async()=>{
  await db.exec('update tenant_feature_policy set enabled=true;revoke execute on function evaluate_trip_live_status_v1(uuid,uuid) from authenticated');
  const result=await request();expect(result.status).toBe(500);expect(await result.json()).toMatchObject({ok:false,processed:0});
 });
 it('rolls back status when creating its automatic alert fails',async()=>{
  await db.exec(`update tenant_feature_policy set enabled=true;
    create function qa_reject_alert() returns trigger language plpgsql as $$begin raise exception 'QA alert failure';end$$;
    create trigger qa_reject_alert before insert on trip_alerts for each row execute function qa_reject_alert();`);
  const result=await request();expect(result.status).toBe(500);
  expect((await db.query('select * from trip_live_status')).rows).toEqual([]);
  expect((await db.query('select * from trip_alerts')).rows).toEqual([]);
 });
 it('allows AAL2 admin evaluation but obeys the kill switch',async()=>{
  await db.exec("update tenant_memberships set role='admin';update tenant_feature_policy set enabled=true");await towerActor(db,'aal2');
  expect((await request()).status).toBe(200);
  await db.query("insert into tenant_feature_policy(tenant_id,feature_key,enabled) values($1,'ssx_kill_switch',true)",[i.tenant]);expect((await request()).status).toBe(403);
 });
 it('calculates a route through caller RLS and reports persistence failure',async()=>{
  await position();const result=await request(1,{trip_id:i.trip});expect(result.status).toBe(200);expect(state.route).toHaveBeenCalledOnce();
  expect((await db.query('select trip_id from trip_routes')).rows).toEqual([{trip_id:i.trip}]);
  await db.exec('revoke execute on function commit_trip_route_v1(uuid,uuid,uuid,uuid,jsonb) from authenticated');expect((await request(1,{trip_id:i.trip})).status).toBe(403);
 });
 it('rechecks membership after routing and does not persist after revocation',async()=>{
  await position();state.route.mockImplementation(async()=>{await db.exec('update tenant_memberships set active=false');return {geometryGeoJson:{type:'LineString',coordinates:[[-46,-23],[-46.1,-23.1]]},distanceMeters:500,durationSeconds:60};});
  expect((await request(1,{trip_id:i.trip})).status).toBe(403);expect((await db.query('select * from trip_routes')).rows).toEqual([]);
 });
 it('rejects a stale GPS origin before sending coordinates to the router',async()=>{
  await position("interval '30 minutes'");expect((await request(1,{trip_id:i.trip})).status).toBe(422);
  expect(state.route).not.toHaveBeenCalled();expect((await db.query('select * from trip_routes')).rows).toEqual([]);
 });
 it('does not silently omit a stop without coordinates',async()=>{
  await position();await db.query("insert into dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,status) values($1,$2,2,'Sem coordenadas','pending')",[i.tenant,i.trip]);
  expect((await request(1,{trip_id:i.trip})).status).toBe(422);expect(state.route).not.toHaveBeenCalled();
 });
 it.each(['stop','position','completion'])('rejects the calculated route after a concurrent %s change',async kind=>{
  await position();state.route.mockImplementation(async()=>{
    if(kind==='stop')await db.exec('update dispatch_stops set latitude=-22');
    if(kind==='position')await db.exec("update positions_last set lat=-22,captured_at=clock_timestamp()");
    if(kind==='completion')await db.exec("update dispatch_trips set status='completed'");
    return {geometryGeoJson:{type:'LineString',coordinates:[[-46.1,-23.1],[-46,-23]]},distanceMeters:15000,durationSeconds:900};
  });
  expect((await request(1,{trip_id:i.trip})).status).toBe(409);expect((await db.query('select * from trip_routes')).rows).toEqual([]);
 });
 it('rejects GET before querying or writing',async()=>{expect((await request(0,{},'GET')).status).toBe(405);expect((await request(1,{},'GET')).status).toBe(405);expect(state.client).not.toHaveBeenCalled();});
 it('rejects a request from a stale account or tenant context before provider traffic',async()=>{
  await position();expect((await request(1,{trip_id:i.trip,actor_id:i.other})).status).toBe(409);
  expect((await request(1,{trip_id:i.trip,tenant_id:i.other})).status).toBe(403);expect(state.route).not.toHaveBeenCalled();
 });
 it('requires the recovery contract and rejects malformed JSON',async()=>{
  expect((await request(1,{trip_id:i.trip,request_id:null})).status).toBe(400);
  expect((await state.handlers[1](new Request('https://edge.example.test',{method:'POST',body:'invalid'}))).status).toBe(400);expect(state.route).not.toHaveBeenCalled();
 });
});
