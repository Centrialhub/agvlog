// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createExpenseCreationDatabase,creationContext,creationPayload,creationCommand,manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseAdmin,expensePayload,expenseCommand,expenseContext} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {ownerStatement} from './helpers/deliveryAttemptDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await createExpenseCreationDatabase());},30000);
const actor=(id:string)=>db.query("select set_config('request.jwt.claim.sub',$1,false)",[id]);
beforeEach(async()=>{await db.exec('begin');await actor(i.user);});
afterEach(()=>db.exec('rollback'));afterAll(()=>db?.close());
const count=async(table:string)=>(await db.query<{n:number}>('select count(*)::int n from '+table)).rows[0].n;
describe('recoverable expense creation and settlement integration',{timeout:15000},()=>{
 it('creates one pending expense and exactly replays a lost acknowledgement',async()=>{
  const p=await creationPayload(db,trip),result=await creationCommand(db,p);expect(await creationCommand(db,p)).toEqual(result);
  expect(result).toMatchObject({status:'pending',confirmed:true,receipt_path:null});expect(await count('driver_expenses')).toBe(1);expect(await count('driver_expense_creations')).toBe(1);
  expect(await count('financial_obligations')).toBe(0);expect(await count('bank_transactions')).toBe(0);await db.exec('set constraints all immediate');
 });
 it('rejects changed fields with the same request and a stale source revision',async()=>{
  const p=await creationPayload(db,trip);await creationCommand(db,p);await expect(creationCommand(db,{...p,fields:{...p.fields,amount_cents:1}})).rejects.toThrow('key_mismatch');
  const next=await creationPayload(db,trip);await db.query('update dispatch_trips set notes=$1 where id=$2',['Contexto alterado',trip]);await expect(creationCommand(db,next)).rejects.toThrow('context_changed');
 });
 it('recovers its committed result even after the trip context changes',async()=>{
  const p=await creationPayload(db,trip),result=await creationCommand(db,p);await db.query('update dispatch_trips set notes=$1 where id=$2',['Outra observação',trip]);expect(await creationCommand(db,p)).toEqual(result);
 });
 it('denies other tenants, actors, revoked membership and inactive driver replay',async()=>{
  const p=await creationPayload(db,trip);await creationCommand(db,p);
  await expect(creationCommand(db,{...p,actor_id:i.operator})).rejects.toThrow('not_authorized');
  await expect(creationCommand(db,{...p,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');
  await db.query('update drivers set active=false where id=$1',[i.driver]);await expect(creationCommand(db,p)).rejects.toThrow('not_authorized');
  await db.query('update drivers set active=true where id=$1',[i.driver]);await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);await expect(creationCommand(db,p)).rejects.toThrow('not_authorized');
 });
 it('rejects missing evidence, fractional cents, bad category and contradictory payment fields',async()=>{
  for(const fields of [{amount_cents:1.001},{amount_cents:0},{amount_cents:-1},{category:'invalid'},{odometer:-1},{no_receipt:false},{no_receipt_reason:'x'},{payment_source:'company_card',reimbursable:true},{payment_source:'advance',reimbursable:false},{paid_with_advance:true},{expense_at:'2026-08-30T12:00:00'}]){
   const p=await creationPayload(db,trip);await expect(creationCommand(db,{...p,fields:{...p.fields,...fields}})).rejects.toThrow();
  }expect(await count('driver_expenses')).toBe(0);
 });
 it('derives the advance flag and never creates a payment when recording an expense',async()=>{
  const p=await creationPayload(db,trip);await creationCommand(db,{...p,fields:{...p.fields,payment_source:'advance'}});
  expect((await db.query('select payment_source,reimbursable,paid_with_advance from driver_expenses')).rows[0]).toEqual({payment_source:'advance',reimbursable:true,paid_with_advance:true});expect(await count('bank_transactions')).toBe(0);
 });
 it('requires the exact gateway-scanned receipt, actor, request and source',async()=>{
  const p=await creationPayload(db,trip);p.receipt={sha256:'a'.repeat(64),mime:'image/png',size:8};p.fields.no_receipt=false;p.fields.no_receipt_reason='';
  await expect(creationCommand(db,p)).rejects.toThrow('not_uploaded');
  const probe=(await db.query<{result:{path:string;metadata:Record<string,unknown>}}>('select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[i.tenant,i.user,p.request_id,'trip',trip,JSON.stringify(p.receipt)])).rows[0].result;
  await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[probe.path,JSON.stringify({...probe.metadata,actor_id:i.operator})]);
  await expect(creationCommand(db,p)).rejects.toThrow('existing_object_mismatch');
  await db.query('update storage.objects set user_metadata=$1::jsonb where name=$2',[JSON.stringify(probe.metadata),probe.path]);
  expect((await creationCommand(db,p)).receipt_path).toBe(probe.path);await db.exec('set constraints all immediate');
 });
 it('rejects supplied arbitrary paths and the service-only upload probe for browser roles',async()=>{
  const p=await creationPayload(db,trip);await expect(creationCommand(db,{...p,receipt:{path:i.otherTenant+'/foreign.png'},fields:{...p.fields,no_receipt:false,no_receipt_reason:null}})).rejects.toThrow();
  await expect(operationRpc(db,"select inspect_expense_receipt_upload($1,$2,$3,'trip',$4,'{}')",[i.tenant,i.user,i.request,trip])).rejects.toThrow('permission denied');
 });
 it('preserves created economic fields and audit evidence; closes legacy APIs',async()=>{
  const result=await creationCommand(db,await creationPayload(db,trip));
  await expect(ownerStatement(db,'update driver_expenses set amount=1 where id=$1',[result.expense_id])).rejects.toThrow('immutable');
  await expect(ownerStatement(db,'delete from driver_expense_creations where id=$1',[result.command_id])).rejects.toThrow('append-only');
  await expect(operationRpc(db,"select driver_create_expense($1,'food',25)",[trip])).rejects.toThrow('permission denied');
  await expect(operationRpc(db,"select add_driver_settlement_manual_expense($1,'food',25,now(),'operation')",[i.request])).rejects.toThrow('permission denied');
 });
 it('rolls back the expense and settlement flag when the durable audit fails',async()=>{
  await db.query('insert into driver_settlements(tenant_id,dispatch_trip_id,driver_id,needs_recalculation) values($1,$2,$3,false)',[i.tenant,trip,i.driver]);
  await db.exec("create function qa_fail_creation() returns trigger language plpgsql as $$begin raise exception 'QA audit failed';end;$$;create trigger qa_fail_creation before insert on driver_expense_creations for each row execute function qa_fail_creation();");
  await expect(creationCommand(db,await creationPayload(db,trip))).rejects.toThrow('QA audit failed');expect(await count('driver_expenses')).toBe(0);
  expect((await db.query('select needs_recalculation from driver_settlements')).rows).toEqual([{needs_recalculation:false}]);
 });
 it('manual expense remains in the statement after approval and repeated recalculation',async()=>{
  await actor(i.operator);await expenseAdmin(db);const s=await manualSettlement(db),p=await creationPayload(db,s,'settlement',i.operator),result=await creationCommand(db,p);
  expect((await db.query('select dispatch_trip_id,manual_settlement_id from driver_expenses')).rows[0]).toEqual({dispatch_trip_id:null,manual_settlement_id:s});
  expect((await expenseContext(db,result.expense_id)).can_approve).toBe(true);await expenseCommand(db,await expensePayload(db,result.expense_id));
  await db.query('select _build_manual_driver_settlement($1)',[s]);await db.query('select _build_manual_driver_settlement($1)',[s]);
  expect((await db.query('select approved_expenses_total::float approved,expenses_total::float total,driver_reimbursement_total::float reimbursement,driver_payable_amount::float payable,needs_recalculation from driver_settlements where id=$1',[s])).rows[0]).toEqual({approved:25,total:25,reimbursement:25,payable:25,needs_recalculation:false});
  expect((await db.query("select source_id,amount::float amount from driver_settlement_items where settlement_id=$1 and item_type='expense'",[s])).rows).toEqual([{source_id:result.expense_id,amount:25}]);
  expect(await count('driver_settlement_payments')).toBe(0);await db.exec('set constraints all immediate');
 });
 it('manual pending, rejected and company-paid items are shown but not reimbursed',async()=>{
  await actor(i.operator);await expenseAdmin(db);const s=await manualSettlement(db);
  await creationCommand(db,await creationPayload(db,s,'settlement',i.operator));
  const reject=await creationCommand(db,await creationPayload(db,s,'settlement',i.operator));await expenseCommand(db,await expensePayload(db,reject.expense_id,'reject'));
  const company=await creationPayload(db,s,'settlement',i.operator);company.fields.payment_source='company_card';company.fields.reimbursable=false;const r=await creationCommand(db,company);await expenseCommand(db,await expensePayload(db,r.expense_id));
  await db.query('select _build_manual_driver_settlement($1)',[s]);
  expect((await db.query('select approved_expenses_total::float approved,pending_expenses_total::float pending,rejected_expenses_total::float rejected,expenses_total::float total,driver_payable_amount::float payable from driver_settlements where id=$1',[s])).rows[0]).toEqual({approved:25,pending:25,rejected:25,total:75,payable:0});
  expect(await count('financial_obligations')).toBe(1);expect(await count('bank_transactions')).toBe(0);await db.exec('set constraints all immediate');
 });
 it('denies manual creation to a driver and on a paid statement',async()=>{
  const s=await manualSettlement(db);await expect(creationContext(db,s,'settlement')).rejects.toThrow('not_authorized');
  await actor(i.operator);await db.query("update driver_settlements set status='paid' where id=$1",[s]);expect((await creationContext(db,s,'settlement')).can_create).toBe(false);
  await expect(creationCommand(db,await creationPayload(db,s,'settlement',i.operator))).rejects.toThrow('source_locked');
 });
 it('driver history includes the administrative review reason and manual expense',async()=>{
  await actor(i.operator);await expenseAdmin(db);const s=await manualSettlement(db),result=await creationCommand(db,await creationPayload(db,s,'settlement',i.operator));
  const p=await expensePayload(db,result.expense_id,'reject');await expenseCommand(db,p);await actor(i.user);
  const history=(await operationRpc<{result:{total:number;rows:Array<{id:string;review_reason:string;approval_status:string}>}}>(db,'select list_driver_expenses($1) result',[i.tenant])).rows[0].result;
  expect(history.total).toBe(1);expect(history.rows[0]).toMatchObject({id:result.expense_id,review_reason:p.reason,approval_status:'rejected'});
 });
 it('Storage RLS isolates reserved receipts and denies browser deletion, replacement and forgery',async()=>{
  const own=i.tenant+'/expense-receipts/'+i.user+'/'+i.request+'/receipt.png',foreign=i.tenant+'/expense-receipts/'+i.operator+'/'+i.request+'/receipt.png';
  await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1),('receipts',$2)",[own,foreign]);
  expect((await operationRpc(db,"select name from storage.objects where bucket_id='receipts'")).rows).toEqual([{name:own}]);
  await operationRpc(db,'delete from storage.objects where name=$1',[own]);expect((await db.query('select count(*)::int n from storage.objects where name=$1',[own])).rows[0]).toEqual({n:1});
  await expect(operationRpc(db,"insert into storage.objects(bucket_id,name) values('receipts',$1)",[own+'x'])).rejects.toThrow('row-level security');
  await actor(i.operator);expect((await operationRpc(db,"select name from storage.objects where bucket_id='receipts' order by name")).rows).toHaveLength(2);
  await operationRpc(db,"update storage.objects set user_metadata='{}' where name=$1",[own]);
  expect((await db.query('select user_metadata from storage.objects where name=$1',[own])).rows[0]).toEqual({user_metadata:null});
  await operationRpc(db,'delete from storage.objects where name=$1',[own]);expect((await db.query('select count(*)::int n from storage.objects where name=$1',[own])).rows[0]).toEqual({n:1});
 });
 it('the driver can read a receipt uploaded by operations for their manual expense, but not its creation audit',async()=>{
  await actor(i.operator);const s=await manualSettlement(db),p=await creationPayload(db,s,'settlement',i.operator);p.receipt={sha256:'c'.repeat(64),mime:'application/pdf',size:10};p.fields.no_receipt=false;p.fields.no_receipt_reason='';
  const probe=(await db.query<{result:{path:string;metadata:unknown}}>('select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[i.tenant,i.operator,p.request_id,'settlement',s,JSON.stringify(p.receipt)])).rows[0].result;
  await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[probe.path,JSON.stringify(probe.metadata)]);await creationCommand(db,p);await actor(i.user);
  expect((await operationRpc(db,'select name from storage.objects where name=$1',[probe.path])).rows).toEqual([{name:probe.path}]);
  expect((await operationRpc(db,'select * from driver_expense_creations')).rows).toEqual([]);await db.exec('set constraints all immediate');
 });
 it('refuses to erase ambiguous legacy manual items during recalculation',async()=>{
  const expense=await creationCommand(db,await creationPayload(db,trip));await actor(i.operator);const s=await manualSettlement(db);
  await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,source_table,source_id,description,amount) values($1,$2,'expense','driver_expenses',$3,'Vínculo legado a conferir',25)",[i.tenant,s,expense.expense_id]);
  await expect(operationRpc(db,'select recalculate_manual_expense_settlement($1,$2)',[i.tenant,s])).rejects.toThrow('reconciliation_required');
  expect((await db.query("select amount::float amount from driver_settlement_items where settlement_id=$1 and item_type='expense'",[s])).rows).toEqual([{amount:25}]);
 });
});
