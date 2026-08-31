// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {settlementAdjustmentDatabase,settlementAdjustmentSql,adjustmentActor,adjustmentCommand,adjustmentPayload,legacyAdjustment} from './helpers/settlementAdjustmentDatabase';
import {settlementAdjustmentRelease} from './helpers/settlementAdjustmentRelease';
import {manualSettlement} from './helpers/expenseCreationDatabase';
let db:PGlite;beforeAll(async()=>{({db}=await settlementAdjustmentDatabase());},30000);afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');await adjustmentActor(db);});afterEach(async()=>{await db.exec('rollback');});
describe('settlement adjustment forward containment',()=>{
 it('suspends writers without deleting evidence and resumes exact replay, never the legacy API',async()=>{
  const source=await manualSettlement(db),p=await adjustmentPayload(db,source),ack=await adjustmentCommand(db,p);
  const before=(await db.query('select to_jsonb(x) row from driver_settlement_adjustments x')).rows;await settlementAdjustmentRelease(db,'contain');
  await expect(adjustmentCommand(db,p)).rejects.toMatchObject({code:'42501'});await settlementAdjustmentRelease(db,'resume');
  expect(await adjustmentCommand(db,p)).toEqual(ack);expect((await db.query('select to_jsonb(x) row from driver_settlement_adjustments x')).rows).toEqual(before);await expect(legacyAdjustment(db,source)).rejects.toMatchObject({code:'42501'});
 });
 it('refuses changed function bodies without changing grants',async()=>{
  await db.exec("create or replace function settlement_adjustment_private.cents(_amount numeric) returns bigint language sql immutable security invoker set search_path='' as $$select 0::bigint$$");
  await expect(settlementAdjustmentRelease(db,'contain')).rejects.toThrow(/function or grants changed/);
  expect((await db.query<{yes:boolean}>("select has_function_privilege('authenticated','public.apply_driver_settlement_adjustment(jsonb)','execute') yes")).rows[0].yes).toBe(true);
 });
 it('refuses ledger policy and direct-write drift',async()=>{
  await db.exec('alter table driver_settlement_adjustments disable row level security');await expect(settlementAdjustmentRelease(db,'contain')).rejects.toThrow(/evidence or write boundary changed/);
 });
 it('still refuses a dropped column NOT NULL across the catalog versions',async()=>{
  await db.exec('alter table driver_settlement_adjustments alter column reason drop not null');await expect(settlementAdjustmentRelease(db,'contain')).rejects.toThrow(/evidence or write boundary changed/);
 });
 it('does not restore execution after a legacy privilege is reopened',async()=>{
  await settlementAdjustmentRelease(db,'contain');await db.exec('grant execute on function public.add_driver_settlement_adjustment(uuid,text,numeric,text,text) to authenticated');
  await expect(settlementAdjustmentRelease(db,'resume')).rejects.toThrow(/function or grants changed/);
 });
 it('refuses installation against a changed actual builder',async()=>{
  const other=await settlementAdjustmentDatabase(false);try{
   await other.db.exec("create or replace function public._build_manual_driver_settlement(_settlement_id uuid) returns uuid language sql as $$select $1$$");
   await expect(other.db.exec(settlementAdjustmentSql())).rejects.toThrow(/dependency changed/);
   expect((await other.db.query<{present:boolean}>("select to_regclass('public.driver_settlement_adjustments') is not null present")).rows[0].present).toBe(false);
  }finally{await other.db.close();}
 },15000);
});
