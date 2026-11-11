// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterEach, describe, expect, it } from 'vitest';
import type { PGlite } from '@electric-sql/pglite';
import { controlTowerDatabase, seedTower, towerActor, towerIds as ids, towerRead } from './helpers/controlTowerDatabase';
import { readTowerSnapshot } from '@/lib/controlTower/contracts';

const forward=readFileSync('supabase/migrations/20261111154053_restore_operations_read_contracts.sql','utf8');
const oldReader=readFileSync('docs/qa/operations-read-before-2026-11-11/get_active_trips_live.sql','utf8');
const oldSnapshot=readFileSync('docs/qa/operations-read-before-2026-11-11/get_control_tower_snapshot_v1.sql','utf8');
const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
let db:PGlite;
afterEach(async()=>{await db?.close();});
async function setup(){
  db=await controlTowerDatabase();await seedTower(db);
  // Real baseline table definitions/defaults. No production data or external services.
  for(const name of ['tenants','orders','clients','incidents','maintenance_orders','employees','stock_items']){
    const ddl=baseline.match(new RegExp('CREATE TABLE public\\.'+name+' \\([\\s\\S]*?\\n\\);'))?.[0];
    if(!ddl)throw new Error('Missing baseline table '+name);await db.exec(ddl);
    for(const sql of baseline.match(new RegExp('ALTER TABLE ONLY public\\.'+name+'\\s+ALTER COLUMN[\\s\\S]*?;','g'))??[])await db.exec(sql);
  }
  await db.exec(`insert into tenants(id,name,plan_key,timezone) values('${ids.tenant}','QA','qa','America/Sao_Paulo'),('${ids.other}','Other','qa','UTC');`);
  await db.exec(oldReader);await db.exec(oldSnapshot);
}
async function summary(tenant=ids.tenant){
  await db.exec('set role authenticated');
  try{return (await db.query<{data:Record<string,unknown>}>('select public.operations_dashboard_summary_v1($1) data',[tenant])).rows[0].data;}
  finally{await db.exec('reset role');}
}

describe('production operational read contract recovery (native SQL)',()=>{
  it('reproduces both published failures, repairs them and supports reapplication',async()=>{
    await setup();
    await expect(summary()).rejects.toThrow(/does not exist/);
    const old=await towerRead(db,'get_control_tower_snapshot_v1');
    expect(()=>readTowerSnapshot(old,ids.tenant)).toThrow();
    await db.exec(forward);
    const current=readTowerSnapshot(await towerRead(db,'get_control_tower_snapshot_v1'),ids.tenant);
    expect(current.trip_total).toBe(2);expect(current.alert_total).toBe(0);
    expect(current.trips.find(t=>t.trip_id===ids.trip)).toMatchObject({pending_stops_total:1,loads_total:1,tracking_enabled:false,lat:null,lng:null});
    expect(await summary()).toMatchObject({active_loads:1,in_transit_loads:1});
    await db.exec(forward);
    expect(readTowerSnapshot(await towerRead(db,'get_control_tower_snapshot_v1'),ids.tenant).trip_total).toBe(2);
  },30000);

  it('returns authoritative bounds for stops, loads and prioritized alerts',async()=>{
    await setup();await db.exec(forward);
    await db.exec(`insert into dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,status) select '${ids.tenant}','${ids.trip}',g,'QA','pending' from generate_series(2,65) g;
      insert into dispatch_stops(tenant_id,dispatch_trip_id,stop_order,destination,status) select '${ids.tenant}','${ids.trip}',g,'QA done','delivered' from generate_series(66,125) g;
      with extra as (insert into loads(tenant_id,load_number,status,total_weight_kg) select '${ids.tenant}','QA-'||g,'in_transit',1 from generate_series(1,29) g returning id)
      insert into dispatch_trip_loads(tenant_id,dispatch_trip_id,load_id) select '${ids.tenant}','${ids.trip}',id from extra;
      insert into trip_alerts(tenant_id,trip_id,type,severity,status,title,opened_at) select '${ids.tenant}','${ids.trip}','manual','warning','open','QA',now() from generate_series(1,205);
      insert into trip_alerts(tenant_id,trip_id,type,severity,status,title,opened_at) values('${ids.tenant}','${ids.trip}','manual','critical','open','Priority QA',now());`);
    const result=readTowerSnapshot(await towerRead(db,'get_control_tower_snapshot_v1'),ids.tenant);
    const trip=result.trips.find(t=>t.trip_id===ids.trip)!;
    expect(trip.pending_stops).toHaveLength(50);expect(trip.pending_stops_total).toBe(65);expect(trip.pending_stops_truncated).toBe(true);
    expect(trip.previous_stops).toHaveLength(50);expect(trip.previous_stops_total).toBe(60);expect(trip.previous_stops_truncated).toBe(true);
    expect(trip.loads).toHaveLength(25);expect(trip.loads_total).toBe(30);expect(trip.loads_truncated).toBe(true);
    expect(result.alerts).toHaveLength(200);expect(result.alert_total).toBe(206);expect(result.alerts_truncated).toBe(true);
    expect(result.alerts[0].severity).toBe('critical');expect(result.alerts[0].trip_code).toBe('1003');
  },30000);

  it('keeps tenant authorization and authoritative summary after changed state/rollback',async()=>{
    await setup();await db.exec(forward);
    await db.exec(`insert into orders(tenant_id,order_number,status,promised_date) values('${ids.tenant}','QA1','pending',current_date-2),('${ids.other}','QA2','pending',current_date-2);`);
    expect(await summary()).toMatchObject({pending_orders:1,delayed_orders:1});
    await db.exec('begin');await db.exec(`update orders set status='delivered' where tenant_id='${ids.tenant}'`);
    expect(await summary()).toMatchObject({pending_orders:0,delayed_orders:0});await db.exec('rollback');
    expect(await summary()).toMatchObject({pending_orders:1});
    await expect(summary(ids.other)).rejects.toThrow(/operator_required/);
    await expect(towerRead(db,'get_control_tower_snapshot_v1',ids.other)).rejects.toThrow(/Forbidden/);
    await towerActor(db,'aal1','');await expect(summary()).rejects.toThrow(/operator_required/);
    await towerActor(db);await db.exec(`update tenant_memberships set active=false where user_id='${ids.actor}'`);
    await expect(summary()).rejects.toThrow(/operator_required/);await expect(towerRead(db,'get_control_tower_snapshot_v1')).rejects.toThrow(/Forbidden/);
    const acl=await db.query<{anon:boolean;authenticated:boolean}>(`select has_function_privilege('anon','public.operations_dashboard_summary_v1(uuid)','execute') anon,has_function_privilege('authenticated','public.operations_dashboard_summary_v1(uuid)','execute') authenticated`);
    expect(acl.rows[0]).toEqual({anon:false,authenticated:true});
  },30000);
});
