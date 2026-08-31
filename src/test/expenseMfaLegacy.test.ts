// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {expenseMfaDatabase,expenseMfaActor,expenseMfaRole} from './helpers/expenseMfaDatabase';
import {manualSettlement,creationContext,creationPayload,creationCommand} from './helpers/expenseCreationDatabase';
import {expenseContext} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite;
beforeAll(async()=>{({db}=await expenseMfaDatabase(false));},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await expenseMfaActor(db);});
afterEach(async()=>{await db.exec('rollback');});
describe('local reproduction with actual MFA release helpers',()=>{
 it.each(['owner','admin'])('allows %s without MFA to create but denies review',async(role)=>{
  await expenseMfaRole(db,role);const source=await manualSettlement(db);
  expect((await operationRpc(db,'select is_tenant_operator_or_admin($1) allowed',[i.tenant])).rows[0].allowed).toBe(false);
  expect((await creationContext(db,source,'settlement')).can_create).toBe(true);
  const result=await creationCommand(db,await creationPayload(db,source,'settlement',i.operator));
  expect(result.confirmed).toBe(true);await expect(expenseContext(db,result.expense_id)).rejects.toMatchObject({code:'42501',message:'expense_not_authorized'});
 });
 it('replays an AAL2 confirmation, reads its audit and recalculates at AAL1',async()=>{
  await expenseMfaRole(db,'admin');await expenseMfaActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  const payload=await creationPayload(db,source,'settlement',i.operator),result=await creationCommand(db,payload);
  await expenseMfaActor(db);
  expect(await creationCommand(db,payload)).toEqual(result);
  expect((await operationRpc(db,'select count(*)::int n from driver_expense_creations')).rows[0].n).toBe(1);
  expect((await operationRpc(db,'select recalculate_manual_expense_settlement($1,$2) id',[i.tenant,source])).rows[0].id).toBe(source);
 });
});
