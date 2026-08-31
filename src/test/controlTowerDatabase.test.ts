// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { controlTowerDatabase, seedTower, towerActor, towerIds as i, towerRead } from './helpers/controlTowerDatabase';
import type { ActiveTripLive } from '@/lib/controlTower/types';
let db: PGlite;
beforeAll(async () => { db = await controlTowerDatabase(); await seedTower(db); }, 20000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
const rows = () => towerRead<ActiveTripLive[]>(db);
async function position(age = "interval '1 minute'") {
  await db.query(`insert into positions_last(tenant_id,vehicle_id,lat,lng,speed,captured_at,received_at) values($1,$2,-23,-46,30,now()-${age},now())`, [i.tenant, i.vehicle]);
}
describe('Control Tower actual SQL readers, with internal RLS and MFA', () => {
  it('includes canonical transit without a legacy primary load and never reports disabled tracking as normal', async () => {
    const value = await rows(); expect(value).toHaveLength(2);
    expect(value.find(t => t.trip_id === i.trip)).toMatchObject({trip_code:'1003', state:'tracking_disabled',vehicle_plate:'QA-1234',loads:[{id:i.load}],pending_stops:[{id:i.stop,latitude:-23,longitude:-46}]});
    expect(value.find(t => t.trip_id === i.planned)).toMatchObject({state:'planned'});
  });
  it.each(['completed','cancelled'])('excludes %s trips', async status => {
    await db.query('update dispatch_trips set status=$1 where id=$2', [status,i.trip]);
    expect((await rows()).map(t => t.trip_id)).not.toContain(i.trip);
  });
  it('reads arrival and terminal outcomes directly, without waiting for a telemetry refresh', async () => {
    await db.query("update dispatch_stops set status='arrived',actual_arrival_at=now() where id=$1",[i.stop]);
    expect((await rows())[0].next_stop).toMatchObject({id:i.stop,status:'arrived'});
    await db.query("update dispatch_stops set status='returned' where id=$1",[i.stop]);
    expect((await rows())[0]).toMatchObject({next_stop:null,pending_stops:[],previous_stops:[{id:i.stop,status:'returned'}]});
  });
  it('counts distinct documents, not line items or merchandise without invoices', async () => {
    await db.query("insert into load_items(tenant_id,load_id,item_description,quantity,fiscal_document_id) values($1,$2,'QA',1,$3),($1,$2,'QA2',1,$3),($1,$2,'Manual',1,null)",[i.tenant,i.load,i.stop]);
    expect((await rows())[0].loads[0].documents_count).toBe(1);
  });
  it('suppresses cross-tenant vehicle, driver, load and stop links even for a member of both tenants', async () => {
    await db.query("insert into tenant_memberships(tenant_id,user_id,role) values($1,$2,'operator')",[i.other,i.actor]);
    for (const table of ['vehicles','drivers','loads','dispatch_stops']) await db.query(`update ${table} set tenant_id=$1`,[i.other]);
    expect((await rows())[0]).toMatchObject({vehicle_plate:null,driver_name:null,loads:[],pending_stops:[]});
  });
  it.each(['driver','client'])('denies %s access to both internal readers', async role => {
    await db.query('update tenant_memberships set role=$1',[role]);
    for (const name of ['get_active_trips_live','get_open_trip_alerts']) {
      await db.exec('savepoint denied'); await expect(towerRead(db,name)).rejects.toThrow(/Forbidden/); await db.exec('rollback to denied');
    }
  });
  it.each(['owner','admin'])('requires AAL2 for %s and accepts a valid AAL2 reader', async role => {
    await db.query('update tenant_memberships set role=$1',[role]);
    await db.exec('savepoint denied'); await expect(rows()).rejects.toThrow(/Forbidden/); await db.exec('rollback to denied');
    await towerActor(db,'aal2'); expect(await rows()).toHaveLength(2);
  });
  it('denies inactive membership and a different tenant', async () => {
    await db.exec('savepoint denied'); await expect(towerRead(db,'get_open_trip_alerts',i.other)).rejects.toThrow(/Forbidden/); await db.exec('rollback to denied');
    await db.exec('update tenant_memberships set active=false'); await expect(rows()).rejects.toThrow(/Forbidden/);
  });
  it('uses invoker semantics and grants no anon or service access', async () => {
    const result=await db.query<{prosecdef:boolean;anon:boolean;service:boolean;authenticated:boolean}>(`select p.prosecdef,
      has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service,
      has_function_privilege('authenticated',p.oid,'execute') authenticated from pg_proc p
      where p.oid in ('public.get_active_trips_live(uuid)'::regprocedure,'public.get_open_trip_alerts(uuid)'::regprocedure)`);
    expect(result.rows).toEqual([{prosecdef:false,anon:false,service:false,authenticated:true},{prosecdef:false,anon:false,service:false,authenticated:true}]);
  });
  it('RLS denial remains effective inside the invoker reader', async () => {
    await db.exec("create policy qa_deny_trip on dispatch_trips as restrictive for select to authenticated using(false)");
    expect(await rows()).toEqual([]);
  });
  it('SSX disabled and kill switch suppress even stored fresh positions', async () => {
    await position();expect((await rows())[0]).toMatchObject({state:'tracking_disabled',lat:null,last_signal_at:null});
    await db.exec("update tenant_feature_policy set enabled=true");
    await db.query("insert into tenant_feature_policy(tenant_id,feature_key,enabled) values($1,'ssx_kill_switch',true)",[i.tenant]);
    expect((await rows())[0]).toMatchObject({state:'tracking_disabled',lat:null});
  });
  it.each(["interval '20 minutes'","interval '-10 minutes'"])('rejects stale or future telemetry (%s)',async age=>{
    await db.exec('update tenant_feature_policy set enabled=true');await position(age);
    expect((await rows())[0]).toMatchObject({state:'no_signal',lat:null,speed_kmh:null});
  });
  it('does not invent normal/zero speed before the fresh position has a computed status',async()=>{
    await db.exec('update tenant_feature_policy set enabled=true');await position();
    expect((await rows())[0]).toMatchObject({state:'unknown',lat:-23,speed_kmh:30});
  });
  it('keeps open manual alerts and sorts by severity without writes',async()=>{
    await db.query("insert into trip_alerts(tenant_id,trip_id,type,severity,title) values($1,$2,'manual_occurrence','critical','Ajuda'),($1,$2,'no_signal','danger','Sinal')",[i.tenant,i.trip]);
    expect(await towerRead(db,'get_open_trip_alerts')).toMatchObject([{title:'Ajuda'}]);
    expect((await db.query('select status from trip_alerts')).rows).toEqual([{status:'open'},{status:'open'}]);
  });
  it('the earlier privileges draft no longer revokes these active APIs',()=>{
    const draft=readFileSync('supabase/migrations/20260830005603_close_authenticated_security_definer_surface.sql','utf8');
    expect(draft).not.toMatch(/revoke[^;]+function public\.get_(active_trips_live|open_trip_alerts)/);
  });
});
