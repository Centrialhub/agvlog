// @vitest-environment node
import {readFileSync} from 'node:fs';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {settlementAdjustmentDatabase,tripSettlement} from './helpers/settlementAdjustmentDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {towerRouteFinanceSql,towerRouteSql} from './helpers/controlTowerDatabase';
let db:PGlite,trip:string;
const acl=()=>db.query("select proacl::text acl from pg_proc where oid='public._build_driver_settlement(uuid,uuid)'::regprocedure");
beforeAll(async()=>{
 ({db,trip}=await settlementAdjustmentDatabase());
 // The complete existing financial graph/builders remain real. Install the
 // private receipt rowtype needed to compile the new route writer (not invoked
 // in this fixture; its handler/UI/concurrency tests use the tower fixture).
 await db.exec('create schema control_tower_private');
 const table=towerRouteSql().match(/create table control_tower_private.route_calculations \([\s\S]*?\n\);/)?.[0];
 if(!table)throw new Error('Missing actual route receipt schema');await db.exec(table);
 await db.exec('alter table trip_routes add column plan_revision text');
 const before=(await acl()).rows;await db.exec(towerRouteFinanceSql());expect((await acl()).rows).toEqual(before);
},30000);
afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});
const insert=async(full:number|null)=>db.query(`insert into trip_routes(tenant_id,trip_id,provider,geometry_geojson,distance_meters,planned_distance_meters,full_plan_revision)
 values($1,$2,'osrm','{"type":"LineString","coordinates":[[0,0],[1,1]]}',7000,$3,case when $3::numeric is not null then control_tower_private.full_plan_revision($1,$2) end)`,[i.tenant,trip,full]);
const estimate=async()=>{const id=await tripSettlement(db,trip);return (await db.query('select estimated_km::double precision km,driver_payable_amount::double precision payable,snapshot_json from driver_settlements where id=$1',[id])).rows[0];};
describe('route estimate → complete actual settlement builder',()=>{
 it('uses the full planned distance, not the remaining navigation distance',async()=>{
  await insert(15000);expect(await estimate()).toMatchObject({km:15,payable:0});
  expect((await db.query("select quantity::double precision km from driver_settlement_items where item_type='km'")).rows).toEqual([{km:15}]);
 });
 it('keeps legacy/live-only distances unknown, not zero or a guessed total',async()=>{
  await insert(null);expect(await estimate()).toMatchObject({km:null,payable:0});
  expect((await db.query("select * from driver_settlement_items where item_type='km'")).rows).toEqual([]);
 });
 it('preserves the estimate as stops complete, but invalidates a changed destination',async()=>{
  await insert(15000);await db.query("update dispatch_stops set status='delivered' where dispatch_trip_id=$1",[trip]);expect(await estimate()).toMatchObject({km:15});
  await db.query('update dispatch_stops set longitude=-45 where dispatch_trip_id=$1',[trip]);expect(await estimate()).toMatchObject({km:null});
 });
 it('does not modify payments or payable totals when a route estimate changes',async()=>{
  await insert(15000);const id=await tripSettlement(db,trip);
  await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,description,amount) values($1,$2,'adjustment','credit','QA',25)",[i.tenant,id]);
  await db.query('insert into driver_settlement_payments(tenant_id,settlement_id,amount) values($1,$2,5)',[i.tenant,id]);
  const before=(await db.query('select to_jsonb(p) row from driver_settlement_payments p')).rows;
  const result=await estimate();await db.query('update trip_routes set distance_meters=2000 where trip_id=$1',[trip]);expect(await estimate()).toEqual(result);
  expect((await db.query('select to_jsonb(p) row from driver_settlement_payments p')).rows).toEqual(before);
 });
 it('changes only the estimate source in the existing financial builder',()=>{
  const previous=readFileSync('supabase/migrations/20260830142048_enable_audited_delivery_reallocation.sql','utf8').replace(/\r\n/g,'\n');
  const extract=(sql:string)=>{const start=sql.indexOf('CREATE OR REPLACE FUNCTION public._build_driver_settlement('),tag=sql.indexOf('$function$',start),end=sql.indexOf('$function$',tag+10);return sql.slice(start,end+10);};
  const oldReader=/ {2}SELECT \(tr.distance_meters \/ 1000\.0\) INTO v_estimated_km[\s\S]*?LIMIT 1;/;
  expect(extract(towerRouteFinanceSql().replace(/\r\n/g,'\n'))).toBe(extract(previous).replace(oldReader,'  v_estimated_km := control_tower_private.settlement_route_km(_tenant_id,_dispatch_trip_id);'));
 });
});
