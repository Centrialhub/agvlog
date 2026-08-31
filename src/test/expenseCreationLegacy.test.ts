// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createExpenseCreationLegacyDatabase} from './helpers/expenseCreationDatabase';
import {seedExpense} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await createExpenseCreationLegacyDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);});
afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
describe('legacy expense creation failures reproduced with actual SQL',{timeout:15000},()=>{
 it('duplicates the same driver expense when the response is lost and the same call is repeated',async()=>{
  const sql="select driver_create_expense(_trip_id=>$1,_category=>'food',_amount=>25,_no_receipt=>true,_no_receipt_reason=>'Comprovante indisponível QA') id";
  const first=(await operationRpc(db,sql,[trip])).rows[0].id,second=(await operationRpc(db,sql,[trip])).rows[0].id;expect(first).not.toBe(second);expect((await db.query('select count(*)::int n from driver_expenses')).rows[0]).toEqual({n:2});
 });
 it('accepts an expense without a receipt and without recording it as missing',async()=>{
  const result=await operationRpc(db,"select driver_create_expense(_trip_id=>$1,_category=>'food',_amount=>25) id",[trip]);
  expect((await db.query('select no_receipt,receipt_url,no_receipt_reason from driver_expenses where id=$1',[result.rows[0].id])).rows[0]).toEqual({no_receipt:false,receipt_url:null,no_receipt_reason:null});
 });
 it('accepts a supplied receipt path from another tenant',async()=>{
  const path=i.otherTenant+'/expenses/foreign.png';const result=await operationRpc(db,"select driver_create_expense(_trip_id=>$1,_category=>'food',_amount=>25,_receipt_path=>$2) id",[trip,path]);
  expect((await db.query('select receipt_url from driver_expenses where id=$1',[result.rows[0].id])).rows[0]).toEqual({receipt_url:path});
 });
 it('accepts fractional cents, arbitrary category, negative odometer and contradictory reimbursement',async()=>{
  const result=await operationRpc(db,"select driver_create_expense(_trip_id=>$1,_category=>'unknown-category',_amount=>1.001,_odometer=>-1,_payment_source=>'company_card',_reimbursable=>true,_paid_with_advance=>true) id",[trip]);
  expect((await db.query('select category,amount::float amount,odometer::float odometer,reimbursable,paid_with_advance from driver_expenses where id=$1',[result.rows[0].id])).rows[0]).toEqual({category:'unknown-category',amount:1.001,odometer:-1,reimbursable:true,paid_with_advance:true});
 });
 it('manual recalculation removes expense items and reports zero expense/reimbursement totals',async()=>{
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.operator]);
  const settlement=(await db.query<{id:string}>("insert into driver_settlements(tenant_id,driver_id,is_manual,status) values($1,$2,true,'pending_review') returning id",[i.tenant,i.driver])).rows[0].id;
  const expense=await seedExpense(db,trip,{dispatch_trip_id:null,approval_status:'approved'});
  await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,source_table,source_id,description,amount) values($1,$2,'expense','driver_expenses',$3,'Alimentação QA',25)",[i.tenant,settlement,expense]);
  await db.query('select _build_manual_driver_settlement($1)',[settlement]);
  expect((await db.query('select approved_expenses_total::float approved,expenses_total::float total,driver_reimbursement_total::float reimbursement,driver_payable_amount::float payable from driver_settlements where id=$1',[settlement])).rows[0]).toEqual({approved:0,total:0,reimbursement:0,payable:0});
  expect((await db.query("select count(*)::int n from driver_settlement_items where settlement_id=$1 and item_type='expense'",[settlement])).rows[0]).toEqual({n:0});
 });
});
