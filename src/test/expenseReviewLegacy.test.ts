// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createExpenseReviewDatabase,expenseAdmin,seedExpense} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await createExpenseReviewDatabase(false));},30000);beforeEach(()=>db.exec('begin'));afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
describe('reproduces expense approval failures against actual baseline',{timeout:15000},()=>{
 it('operator direct update succeeds with zero rows and leaves the expense pending',async()=>{
  const id=await seedExpense(db,trip);const result=await operationRpc(db,"update driver_expenses set approval_status='approved' where id=$1 returning id",[id]);expect(result.rows).toEqual([]);expect((await db.query('select approval_status from driver_expenses where id=$1',[id])).rows[0]).toEqual({approval_status:'pending'});
 });
 it('a new expense does not flag a paid settlement for recalculation',async()=>{
  await db.query("insert into driver_settlements(tenant_id,dispatch_trip_id,driver_id,status,needs_recalculation) values($1,$2,$3,'paid',false)",[i.tenant,trip,i.driver]);await seedExpense(db,trip);
  expect((await db.query('select needs_recalculation from driver_settlements where dispatch_trip_id=$1',[trip])).rows[0]).toEqual({needs_recalculation:false});
 });
 it('rejecting a previously approved company expense leaves its obligation active',async()=>{
  await expenseAdmin(db);const id=await seedExpense(db,trip,{payment_source:'company_card',reimbursable:false});await operationRpc(db,"update driver_expenses set approval_status='approved' where id=$1",[id]);await operationRpc(db,"update driver_expenses set approval_status='rejected' where id=$1",[id]);
  expect((await db.query('select amount_expected::float amount,status from financial_obligations where source_id=$1',[id])).rows).toEqual([{amount:25,status:'pending'}]);
 });
 it('manual expense RPC references columns absent from the real expense contract',async()=>{
  const s=(await db.query<{id:string}>('insert into driver_settlements(tenant_id,dispatch_trip_id,driver_id) values($1,$2,$3) returning id',[i.tenant,trip,i.driver])).rows[0].id;
  await expect(operationRpc(db,"select add_driver_settlement_manual_expense($1,'food',25,clock_timestamp(),'route','driver',true,null,'QA')",[s])).rejects.toThrow('vehicle_id');
 });
});
