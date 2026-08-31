// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {settlementAdjustmentDatabase,adjustmentActor,tripSettlement,legacyAdjustment,adjustmentContext,adjustmentPayload,adjustmentCommand} from './helpers/settlementAdjustmentDatabase';
import {manualSettlement,creationPayload,creationCommand} from './helpers/expenseCreationDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {expenseCommand,expensePayload} from './helpers/expenseReviewDatabase';
import {operationRpc,operationIds as i} from './helpers/operationOutcomeDatabase';
let db:PGlite,trip:string;
beforeAll(async()=>{({db,trip}=await settlementAdjustmentDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');await adjustmentActor(db);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const counts=async()=> (await db.query<Record<string,unknown>>('select (select count(*)::int from driver_settlement_adjustments) commands,(select count(*)::int from driver_settlement_payments) payments,(select count(*)::int from financial_obligations) obligations')).rows[0];
const snapshot=async()=>Object.fromEntries(await Promise.all(['loads','dispatch_trips','dispatch_stops','fiscal_documents','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_events','driver_settlement_adjustments','driver_settlement_payments','financial_obligations'].map(async table=>[table,(await db.query<{value:unknown}>('select coalesce(jsonb_agg(to_jsonb(r) order by id),\'[]\') value from '+table+' r')).rows[0].value])));
describe('audited settlement adjustments with actual financial builders',()=>{
 it.each(['manual','trip'])('adds credit/debit, removes and replays exactly for %s',async(type)=>{
  const source=type==='manual'?await manualSettlement(db):await tripSettlement(db,trip);
  const credit=await adjustmentPayload(db,source),result=await adjustmentCommand(db,credit);
  expect(result).toMatchObject({confirmed:true,settlement_id:source,action:'add'});expect(await adjustmentCommand(db,credit)).toEqual(result);
  const debit={...await adjustmentPayload(db,source),nature:'debit',amount_cents:425};await adjustmentCommand(db,debit);
  expect((await adjustmentContext(db,source)).totals).toMatchObject({credits_cents:1000,debits_cents:425,payable_cents:575,paid_cents:0,balance_cents:575});
  const remove=await adjustmentPayload(db,source,result.item_id),removed=await adjustmentCommand(db,remove);
  expect(await adjustmentCommand(db,remove)).toEqual(removed);expect(await adjustmentCommand(db,credit)).toEqual(result);
  expect((await adjustmentContext(db,source)).totals).toMatchObject({credits_cents:0,debits_cents:425,payable_cents:-425});
  expect(await counts()).toEqual({commands:3,payments:0,obligations:0});
  expect((await db.query<{previous:unknown}>("select before_snapshot#>'{evidence,items}' previous from driver_settlement_adjustments where id=$1",[removed.command_id])).rows[0].previous).toEqual(expect.arrayContaining([expect.objectContaining({id:result.item_id,amount:10})]));
 });
 it('preserves approved manual reimbursements and existing payment rows',async()=>{
  await expenseMfaRole(db,'admin');await adjustmentActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  const expense=await creationCommand(db,await creationPayload(db,source,'settlement',i.operator));await expenseCommand(db,await expensePayload(db,expense.expense_id));
  await operationRpc(db,'select recalculate_manual_expense_settlement($1,$2)',[i.tenant,source]);
  // Synthetic historical payment, not a payment API or external transfer.
  await db.query('insert into driver_settlement_payments(tenant_id,settlement_id,amount) values($1,$2,5)',[i.tenant,source]);
  const before=(await db.query<Record<string,unknown>>('select to_jsonb(p) row from driver_settlement_payments p')).rows;
  await adjustmentCommand(db,await adjustmentPayload(db,source));expect((await adjustmentContext(db,source)).totals).toMatchObject({payable_cents:3500,paid_cents:500,balance_cents:3000});
  expect((await db.query<Record<string,unknown>>('select to_jsonb(p) row from driver_settlement_payments p')).rows).toEqual(before);
  expect((await db.query<{n:number}>("select count(*)::int n from driver_settlement_items where item_type='expense' and source_id=$1",[expense.expense_id])).rows[0].n).toBe(1);
 });
 it('does not turn a source change into implicit user confirmation',async()=>{
  const source=await tripSettlement(db,trip),payload=await adjustmentPayload(db,source),before=await counts();
  await db.query("update dispatch_stops set destination='Destino revisto' where dispatch_trip_id=$1",[trip]);
  await expect(adjustmentCommand(db,payload)).rejects.toMatchObject({code:'40001',message:'settlement_adjustment_context_changed'});expect(await counts()).toEqual(before);
 });
 it('requires a new key for a different payload',async()=>{
  const payload=await adjustmentPayload(db,await manualSettlement(db));await adjustmentCommand(db,payload);
  await expect(adjustmentCommand(db,{...payload,amount_cents:2000})).rejects.toMatchObject({code:'22023',message:'settlement_adjustment_key_mismatch'});expect((await counts()).commands).toBe(1);
 });
 it.each([0,-1,0.001,1.2,100000000000000,'1000','NaN',null])('rejects malformed cents %s without a partial write',async(amount)=>{
  const payload={...await adjustmentPayload(db,await manualSettlement(db)),amount_cents:amount};const before=await snapshot();await expect(adjustmentCommand(db,payload)).rejects.toMatchObject({code:'22023'});expect(await snapshot()).toEqual(before);
 });
 it.each([{nature:null},{nature:'other'},{description:' '},{reason:'   '},{extra:true},{item_id:randomUUID()}])('rejects malformed fields %j',async(fields)=>{
  const payload={...await adjustmentPayload(db,await manualSettlement(db)),...fields};await expect(adjustmentCommand(db,payload)).rejects.toMatchObject({code:'22023'});expect((await counts()).commands).toBe(0);
 });
 it.each(['owner','admin'])('enforces %s MFA for context, mutation and replay',async(role)=>{
  const source=await manualSettlement(db),payload=await adjustmentPayload(db,source);await expenseMfaRole(db,role);
  for(const call of [()=>adjustmentContext(db,source),()=>adjustmentCommand(db,payload)])await expect(call()).rejects.toMatchObject({code:'42501',message:'settlement_adjustment_mfa_required'});
  await adjustmentActor(db,i.operator,'aal2');const result=await adjustmentCommand(db,payload);await adjustmentActor(db);
  await expect(adjustmentCommand(db,payload)).rejects.toMatchObject({code:'42501'});expect((await operationRpc(db,'select count(*)::int n from driver_settlement_adjustments')).rows[0].n).toBe(0);
  await adjustmentActor(db,i.operator,'aal2');expect(await adjustmentCommand(db,payload)).toEqual(result);
 });
 it('denies drivers, foreign actors/tenants and revoked membership',async()=>{
  const source=await manualSettlement(db),payload=await adjustmentPayload(db,source);
  await expect(adjustmentCommand(db,{...payload,actor_id:i.user})).rejects.toMatchObject({code:'42501'});
  await expect(adjustmentCommand(db,{...payload,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
  await adjustmentActor(db,i.user);await expect(adjustmentContext(db,source)).rejects.toMatchObject({code:'42501'});
  await adjustmentActor(db);await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);await expect(adjustmentCommand(db,payload)).rejects.toMatchObject({code:'42501'});
 });
 it('preserves exact replay after closing, but rejects new changes',async()=>{
  const source=await manualSettlement(db),payload=await adjustmentPayload(db,source),result=await adjustmentCommand(db,payload);
  await db.query("update driver_settlements set status='approved' where id=$1",[source]);expect(await adjustmentCommand(db,payload)).toEqual(result);
  await expect(adjustmentCommand(db,await adjustmentPayload(db,source))).rejects.toMatchObject({code:'23514',message:'settlement_adjustment_locked'});
 });
 it('removes a single invalid legacy adjustment with evidence instead of propagating NaN',async()=>{
  const source=await manualSettlement(db),row=(await db.query<{id:string}>("insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount) values($1,$2,'adjustment','credit','NaN') returning id",[i.tenant,source])).rows[0];
  expect(await adjustmentContext(db,source)).toMatchObject({can_add:false,requires_reconciliation:true});
  await expect(adjustmentCommand(db,await adjustmentPayload(db,source))).rejects.toThrow('settlement_adjustment_requires_reconciliation');
  await adjustmentCommand(db,await adjustmentPayload(db,source,row.id));expect((await adjustmentContext(db,source)).totals.payable_cents).toBe(0);
 });
 it('rolls back the complete financial calculation on a late audit failure',async()=>{
  const payload=await adjustmentPayload(db,await manualSettlement(db));await db.exec("create function public.qa_fail_adjustment() returns trigger language plpgsql as $$begin raise exception 'qa_late_failure';end$$;create trigger qa_fail before insert on driver_settlement_adjustments for each row execute function public.qa_fail_adjustment()");
  const before=await snapshot();await expect(adjustmentCommand(db,payload)).rejects.toThrow('qa_late_failure');expect(await snapshot()).toEqual(before);
 });
 it('cuts legacy/direct mutation and exposes only guarded invoker APIs',async()=>{
  const source=await manualSettlement(db);await expect(legacyAdjustment(db,source)).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,"insert into driver_settlement_items(tenant_id,settlement_id,item_type,nature,amount) values($1,$2,'adjustment','credit',50)",[i.tenant,source])).rejects.toMatchObject({code:'42501'});
  const rows=(await db.query("select prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and proname in('get_driver_settlement_adjustment_context','apply_driver_settlement_adjustment')")).rows;
  expect(rows).toEqual([{prosecdef:false,anon:false,service:false},{prosecdef:false,anon:false,service:false}]);
 });
 it('preserves append-only evidence and protects the audited settlement from deletion',async()=>{
  const source=await manualSettlement(db);await adjustmentCommand(db,await adjustmentPayload(db,source));
  await expect(operationRpc(db,"delete from driver_settlement_adjustments")).rejects.toMatchObject({code:'42501'});
  await db.exec('savepoint evidence');await expect(db.exec('delete from driver_settlement_adjustments')).rejects.toThrow();await db.exec('rollback to savepoint evidence');
  await db.exec('savepoint parent');await expect(db.query('delete from driver_settlements where id=$1',[source])).rejects.toMatchObject({code:'23001'});await db.exec('rollback to savepoint parent');
 });
});
