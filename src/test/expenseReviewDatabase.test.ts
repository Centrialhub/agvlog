// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createExpenseReviewDatabase,expenseAdmin,seedExpense,expenseContext,expensePayload,expenseCommand} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {ownerStatement} from './helpers/deliveryAttemptDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await createExpenseReviewDatabase());},30000);beforeEach(async()=>{await db.exec('begin');await expenseAdmin(db);});afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
const count=async(table:string)=>(await db.query<{n:number}>('select count(*)::int n from '+table)).rows[0].n;
describe('expense review command and financial integration',{timeout:15000},()=>{
 it('approves once with exact durable replay, without creating a payment',async()=>{
  const expense=await seedExpense(db,trip),p=await expensePayload(db,expense),result=await expenseCommand(db,p);expect(await expenseCommand(db,p)).toEqual(result);expect(result).toMatchObject({expense_id:expense,status:'approved',confirmed:true});
  expect(await count('driver_expense_reviews')).toBe(1);expect(await count('bank_transactions')).toBe(0);expect(await count('financial_obligations')).toBe(0);await db.exec('set constraints all immediate');
 });
 it('creates exactly one company obligation with no bank movement or match',async()=>{
  const expense=await seedExpense(db,trip,{payment_source:'company_card',reimbursable:false});await expenseCommand(db,await expensePayload(db,expense));
  expect((await db.query('select source_id,amount_expected::float amount,amount_matched::float matched,status from financial_obligations')).rows).toEqual([{source_id:expense,amount:25,matched:0,status:'pending'}]);expect(await count('bank_transactions')).toBe(0);expect(await count('financial_matches')).toBe(0);await db.exec('set constraints all immediate');
 });
 it('rejects pending expenses without an obligation and preserves the review reason',async()=>{
  const expense=await seedExpense(db,trip,{payment_source:'company_account',reimbursable:false}),p=await expensePayload(db,expense,'reject');await expenseCommand(db,p);expect((await expenseContext(db,expense)).can_reject).toBe(false);expect(await count('financial_obligations')).toBe(0);expect((await db.query('select reason from driver_expense_reviews')).rows[0]).toEqual({reason:p.reason});
 });
 it('denies operators, drivers, another tenant and revoked administrators, including replay',async()=>{
  const expense=await seedExpense(db,trip),p=await expensePayload(db,expense);await expenseCommand(db,p);await db.query("update tenant_memberships set role='operator' where user_id=$1",[i.operator]);await expect(expenseCommand(db,p)).rejects.toThrow('not_authorized');
  await expenseAdmin(db);await expect(expenseCommand(db,{...p,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await expect(expenseCommand(db,p)).rejects.toThrow('not_authorized');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);await expect(expenseContext(db,expense)).rejects.toThrow('not_authorized');expect((await operationRpc(db,'select * from driver_expense_reviews')).rows).toEqual([]);
 });
 it('refuses changed bodies under the same key and stale revisions after edits',async()=>{
  const expense=await seedExpense(db,trip),p=await expensePayload(db,expense);await db.query('update driver_expenses set notes=$1 where id=$2',['Alterado antes da revisão',expense]);await expect(expenseCommand(db,p)).rejects.toThrow('context_changed');
  const current=await expensePayload(db,expense);await expenseCommand(db,current);await expect(expenseCommand(db,{...current,action:'reject'})).rejects.toThrow('key_mismatch');
 });
 it('blocks malformed legacy values and missing evidence but permits reasoned rejection',async()=>{
  for(const patch of [{amount:1.001},{amount:-1},{amount:'NaN'},{payment_source:'company_card',reimbursable:true},{payment_source:'driver',paid_with_advance:true},{no_receipt:false},{no_receipt:true,no_receipt_reason:''}]){
   const expense=await seedExpense(db,trip,patch);expect((await expenseContext(db,expense)).can_approve).toBe(false);await expect(expenseCommand(db,await expensePayload(db,expense))).rejects.toThrow('requires_reconciliation');await expenseCommand(db,await expensePayload(db,expense,'reject'));
  }expect(await count('financial_obligations')).toBe(0);
 });
 it('checks receipt tenant and actual storage existence',async()=>{
  const expense=await seedExpense(db,trip,{no_receipt:false,no_receipt_reason:null,receipt_url:i.otherTenant+'/receipt.png'});expect((await expenseContext(db,expense)).validation_errors).toContain('receipt');
  const path=i.tenant+'/expenses/'+trip+'/qa.png';await db.query('update driver_expenses set receipt_url=$1 where id=$2',[path,expense]);expect((await expenseContext(db,expense)).can_approve).toBe(false);
  await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)",[path]);expect((await expenseContext(db,expense)).can_approve).toBe(true);await expenseCommand(db,await expensePayload(db,expense));
 });
 it('flags a paid settlement without rewriting its money or status and blocks further payment',async()=>{
  const s=(await db.query<{id:string}>("insert into driver_settlements(tenant_id,dispatch_trip_id,driver_id,status,total_paid_amount,driver_payable_amount,needs_recalculation) values($1,$2,$3,'paid',25,25,false) returning id",[i.tenant,trip,i.driver])).rows[0].id;
  await seedExpense(db,trip);expect((await db.query('select total_paid_amount::float paid,driver_payable_amount::float payable,status,needs_recalculation from driver_settlements where id=$1',[s])).rows[0]).toEqual({paid:25,payable:25,status:'paid',needs_recalculation:true});
  await expect(ownerStatement(db,"insert into driver_settlement_payments(settlement_id,tenant_id,amount) values($1,$2,1)",[s,i.tenant])).rejects.toThrow('requires_review_before_payment');
 });
 it('rolls back approval, obligation and review flag when the final audit fails',async()=>{
  await db.query('insert into driver_settlements(tenant_id,dispatch_trip_id,driver_id) values($1,$2,$3)',[i.tenant,trip,i.driver]);const expense=await seedExpense(db,trip,{payment_source:'company_card',reimbursable:false});await db.query('update driver_settlements set needs_recalculation=false where dispatch_trip_id=$1',[trip]);const p=await expensePayload(db,expense);
  await db.exec("create function qa_fail_expense() returns trigger language plpgsql as $$begin raise exception 'QA expense audit failed';end;$$;create trigger qa_fail_expense before insert on driver_expense_reviews for each row execute function qa_fail_expense();");await expect(expenseCommand(db,p)).rejects.toThrow('QA expense audit failed');
  expect(await count('financial_obligations')).toBe(0);expect(await count('driver_expense_reviews')).toBe(0);expect((await db.query('select approval_status from driver_expenses where id=$1',[expense])).rows[0]).toEqual({approval_status:'pending'});expect((await db.query('select needs_recalculation from driver_settlements where dispatch_trip_id=$1',[trip])).rows[0]).toEqual({needs_recalculation:false});
 });
 it('prevents direct admin writes, reviewed edits and deletion of expense/audit history',async()=>{
  const expense=await seedExpense(db,trip);await expect(operationRpc(db,"update driver_expenses set approval_status='approved' where id=$1",[expense])).rejects.toThrow('permission denied');await expenseCommand(db,await expensePayload(db,expense));
  await expect(ownerStatement(db,'update driver_expenses set amount=1 where id=$1',[expense])).rejects.toThrow('immutable');await expect(ownerStatement(db,'delete from driver_expenses where id=$1',[expense])).rejects.toThrow('immutable');await expect(ownerStatement(db,'delete from driver_expense_reviews where expense_id=$1',[expense])).rejects.toThrow('append-only');
 });
 it('requires a real deferred acknowledgement for the approval',async()=>{
  const expense=await seedExpense(db,trip);await db.exec('savepoint forged');
  try{await db.query("update driver_expenses set approval_status='approved',approved_at=clock_timestamp(),approved_by=$2,review_command_id=$3 where id=$1",[expense,i.operator,i.request]);await expect(db.exec('set constraints all immediate')).rejects.toThrow();}
  finally{await db.exec('rollback to savepoint forged;release savepoint forged');}
 });
 it('paginates pending expenses instead of hiding them behind recent reviewed records',async()=>{
  for(let n=0;n<53;n++)await seedExpense(db,trip);const page=(await operationRpc(db,"select list_driver_expenses_for_review($1,'pending',50) result",[i.tenant])).rows[0].result as {rows:unknown[];total:number;can_review:boolean};expect(page.rows).toHaveLength(3);expect(page.total).toBe(53);expect(page.can_review).toBe(true);
 });
});
