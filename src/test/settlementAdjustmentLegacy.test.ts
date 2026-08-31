// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {settlementAdjustmentDatabase,adjustmentActor,tripSettlement,legacyAdjustment} from './helpers/settlementAdjustmentDatabase';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {operationRpc,operationIds as i} from './helpers/operationOutcomeDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await settlementAdjustmentDatabase(false));},30000);
beforeEach(async()=>{await db.exec('begin');await adjustmentActor(db);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
describe('current adjustment defects with actual builders',()=>{
 it('cannot add a manual adjustment because the trip builder receives NULL',async()=>{
  const source=await manualSettlement(db);await expect(legacyAdjustment(db,source)).rejects.toThrow('trip_not_found');
  expect((await db.query('select count(*)::int n from driver_settlement_items')).rows[0]).toEqual({n:0});
 });
 it('cannot remove a manual adjustment and rolls back deletion',async()=>{
  const source=await manualSettlement(db),row=(await db.query<{id:string}>("insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount) values($1,$2,'adjustment','credit',10) returning id",[i.tenant,source])).rows[0];
  await expect(operationRpc(db,'select remove_driver_settlement_adjustment($1,$2,$3)',[source,row.id,'Remoção QA'])).rejects.toThrow('trip_not_found');
  expect((await db.query('select count(*)::int n from driver_settlement_items where id=$1',[row.id])).rows[0]).toEqual({n:1});
 });
 it('duplicates an identical add request for a trip settlement',async()=>{
  const source=await tripSettlement(db,trip);await legacyAdjustment(db,source);await legacyAdjustment(db,source);
  expect((await db.query("select count(*)::int n,sum(amount)::int amount from driver_settlement_items where settlement_id=$1 and item_type='adjustment'",[source])).rows[0]).toEqual({n:2,amount:20});
 });
 it.each([['null nature',null,'10','Motivo QA'],['fractional cents','credit','0.001','Motivo QA'],['blank reason','credit','10','   '],['NaN','credit','NaN','Motivo QA']])('accepts invalid adjustment: %s',async(_label,nature,amount,reason)=>{
  const source=await tripSettlement(db,trip);await expect(legacyAdjustment(db,source,nature,amount!,reason!)).resolves.toHaveProperty('rows');
  expect((await db.query("select count(*)::int n from driver_settlement_items where settlement_id=$1 and item_type='adjustment'",[source])).rows[0]).toEqual({n:1});
 });
});
