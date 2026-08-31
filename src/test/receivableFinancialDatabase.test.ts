// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createReceivableFinancialDatabase,createFinancialScenario,financialContext,financialPayload,financialCommand,reversalPayload,receivableFinancialSql} from './helpers/receivableFinancialDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {ownerStatement} from './helpers/deliveryAttemptDatabase';
let db:PGlite;
beforeAll(async()=>{({db}=await createReceivableFinancialDatabase());},30000);beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const admin=async(database=db)=>database.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
const count=async(table:string)=>(await db.query<{n:number}>('select count(*)::int n from '+table)).rows[0].n;
describe('receivable commands and immutable compensating reversals',{timeout:15000},()=>{
 it('records once and synchronizes receipt, closing, invoice and bank ledger in one transaction',async()=>{
  const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);const ack=await financialCommand(db,p);expect(await financialCommand(db,p)).toEqual(ack);
  expect(ack).toMatchObject({received_cents:1000,open_cents:23000});for(const table of ['receivables_payments','closing_report_payments','bank_transactions','receivable_financial_commands'])expect(await count(table)).toBe(1);
  expect((await db.query('select status,received_amount::float received from closing_reports where id=$1',[s.report])).rows[0]).toEqual({status:'partially_paid',received:10});
  await db.exec('set constraints all immediate');
 });
 it('rolls back every projection and bank entry after a late acknowledgement failure',async()=>{
  const s=await createFinancialScenario(db);await db.exec("create function qa_fail_financial() returns trigger language plpgsql as $$begin raise exception 'QA financial failure';end;$$;create trigger qa_fail_financial before insert on receivable_financial_commands for each row execute function qa_fail_financial();");
  await expect(financialCommand(db,await financialPayload(db,s.receivable))).rejects.toThrow('QA financial failure');expect(await count('bank_transactions')).toBe(0);expect((await financialContext(db,s.receivable)).received_cents).toBe(0);
 });
 it('marks full collection paid in all three projections and reverses without deleting evidence',async()=>{
  const s=await createFinancialScenario(db);await admin();const payment=await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));
  expect((await db.query('select status from client_invoices where id=$1',[s.invoice])).rows[0]).toEqual({status:'paid'});
  const p=reversalPayload(await financialPayload(db,s.receivable),payment.payment_id!);const reversal=await financialCommand(db,p);expect(await financialCommand(db,p)).toEqual(reversal);
  expect(reversal).toMatchObject({received_cents:0,open_cents:24000});expect(await count('receivables_payments')).toBe(1);expect(await count('closing_report_payments')).toBe(1);expect(await count('bank_transactions')).toBe(2);expect(await count('receivable_payment_reversals')).toBe(1);
  expect((await db.query('select sum(case when transaction_type=\'credit\' then amount else -amount end)::float net from bank_transactions')).rows[0]).toEqual({net:0});
  expect((await db.query('select status from closing_reports where id=$1',[s.report])).rows[0]).toEqual({status:'invoiced'});expect((await financialContext(db,s.receivable)).payments[0].reversed_at).not.toBeNull();await db.exec('set constraints all immediate');
 });
 it('supports full-to-partial reversal and permits a later genuine receipt',async()=>{
  const s=await createFinancialScenario(db);await admin();const first=await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:10000}));await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:14000}));
  await financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),first.payment_id!));expect((await financialContext(db,s.receivable)).received_cents).toBe(14000);
  await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:10000}));expect((await financialContext(db,s.receivable)).open_cents).toBe(0);
 });
 it('rejects stale revisions and changed bodies under a committed request key',async()=>{
  const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);await financialCommand(db,p);
  await expect(financialCommand(db,{...p,reason:'Outro motivo'})).rejects.toThrow('key_mismatch');await expect(financialCommand(db,{...p,request_id:'cf610000-0000-4000-8000-000000000099'})).rejects.toThrow('context_changed');expect(await count('receivables_payments')).toBe(1);
 });
 it('requires an administrator for reversal, and active membership even for durable replay',async()=>{
  const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);const payment=await financialCommand(db,p);
  await expect(financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),payment.payment_id!))).rejects.toThrow('not_authorized');
  await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(financialCommand(db,p)).rejects.toThrow('not_authorized');
 });
 it('denies another tenant or actor and does not expose command records through RLS',async()=>{
  const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);await financialCommand(db,p);
  await expect(financialCommand(db,{...p,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(financialContext(db,s.receivable)).rejects.toThrow('not_authorized');expect((await operationRpc(db,'select * from receivable_financial_commands')).rows).toEqual([]);
 });
 it('refuses overpayment, fractional cents, invalid methods and future dates without ledger writes',async()=>{
  const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);
  for(const patch of [{amount_cents:24001},{amount_cents:0},{amount_cents:1.5},{method:'unknown'},{effective_date:'2999-01-01'},{reason:'x'}])await expect(financialCommand(db,{...p,...patch})).rejects.toThrow('financial_');
  expect(await count('bank_transactions')).toBe(0);
 });
 it('validates account scope and attachment existence before inserting money',async()=>{
  const s=await createFinancialScenario(db),p=await financialPayload(db,s.receivable);
  await expect(financialCommand(db,{...p,bank_account_id:i.otherTenant})).rejects.toThrow('invalid_bank_account');await expect(financialCommand(db,{...p,attachment_path:i.otherTenant+'/receivable-payments/a.pdf'})).rejects.toThrow('invalid_attachment');
  await expect(financialCommand(db,{...p,attachment_path:i.tenant+'/receivable-payments/a.pdf'})).rejects.toThrow('attachment_not_found');
  await db.query('insert into storage.objects(bucket_id,name) values($1,$2)',['receipts',i.tenant+'/receivable-payments/a.pdf']);await financialCommand(db,{...p,attachment_path:i.tenant+'/receivable-payments/a.pdf'});expect(await count('receivables_payments')).toBe(1);
 });
 it('refuses legacy APIs, direct DML, bank-evidence rewrites and historical receipt deletion',async()=>{
  const s=await createFinancialScenario(db);const payment=await financialCommand(db,await financialPayload(db,s.receivable));
  await expect(operationRpc(db,'select reverse_receivable_payment($1)',[payment.payment_id])).rejects.toThrow('permission denied');await expect(operationRpc(db,'select register_closing_report_payment($1,$2::jsonb)',[s.report,'{}'])).rejects.toThrow('permission denied');
  await expect(ownerStatement(db,'delete from receivables_payments')).rejects.toThrow('immutable');await expect(ownerStatement(db,'delete from closing_report_payments')).rejects.toThrow('append-only');
  await expect(ownerStatement(db,"update bank_transactions set amount=1 where id='"+payment.bank_transaction_id+"'")).rejects.toThrow('immutable');await expect(ownerStatement(db,'delete from bank_transactions')).rejects.toThrow('immutable');
  expect((await db.query("select has_table_privilege('authenticated','receivables_payments','INSERT,UPDATE,DELETE') allowed")).rows[0]).toEqual({allowed:false});
 });
 it('does not confuse a receipt reversal with approval of changed fiscal sources',async()=>{
  const s=await createFinancialScenario(db);await admin();const payment=await financialCommand(db,await financialPayload(db,s.receivable));await db.query('update fiscal_documents set freight_value=999 where id=$1',[i.doc]);
  await financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),payment.payment_id!));expect((await financialContext(db,s.receivable)).received_cents).toBe(0);
  expect((await db.query('select total_amount::float amount from closing_reports where id=$1',[s.report])).rows[0]).toEqual({amount:240});
 });
 it('refuses reversing before the original receipt or reversing the same receipt twice',async()=>{
  const s=await createFinancialScenario(db);await admin();const payment=await financialCommand(db,await financialPayload(db,s.receivable));const p=reversalPayload(await financialPayload(db,s.receivable),payment.payment_id!);
  await expect(financialCommand(db,{...p,effective_date:'1900-01-01'})).rejects.toThrow('invalid_reversal_date');await financialCommand(db,p);
  await expect(financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),payment.payment_id!))).rejects.toThrow('valid_state');expect(await count('receivable_payment_reversals')).toBe(1);
 });
 it('supports manual receivables without creating a fake closing or invoice',async()=>{
  const id='cf620000-0000-4000-8000-000000000001';await db.query('insert into receivables(id,tenant_id,amount,status) values($1,$2,100,$3)',[id,i.tenant,'pending']);await db.query('insert into bank_accounts(id,tenant_id,name) values($1,$2,$3)',['cf600000-0000-4000-8000-000000000001',i.tenant,'QA']);
  const ack=await financialCommand(db,await financialPayload(db,id));expect(ack.received_cents).toBe(1000);expect(await count('closing_reports')).toBe(0);expect(await count('client_invoices')).toBe(0);
 });
 it('requires explicit reconciliation when invoice status contradicts an otherwise balanced ledger',async()=>{
  const s=await createFinancialScenario(db);await admin();await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));
  await db.query("update client_invoices set status='generated' where id=$1",[s.invoice]);
  const context=await financialContext(db,s.receivable);expect(context).toMatchObject({requires_reconciliation:true,can_reconcile:true,can_receive:false,can_reverse:false});
  await financialCommand(db,{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:'cf640000-0000-4000-8000-000000000001',receivable_id:s.receivable,expected_revision:context.revision,action:'reconcile',reason:'Conciliar status com recebimento comprovado'});
  expect(await financialContext(db,s.receivable)).toMatchObject({requires_reconciliation:false,received_cents:24000});expect(await count('bank_transactions')).toBe(1);
 });
 it('reconciles an existing proven legacy receipt explicitly instead of silently overwriting the closing',async()=>{
  const previous=await createReceivableFinancialDatabase(false);try{
   await previous.db.exec('begin');const s=await createFinancialScenario(previous.db);
   await operationRpc(previous.db,'select register_receivable_payment($1,10,clock_timestamp(),$2)',[s.receivable,s.bank]);
   expect((await previous.db.query('select received_amount::float received from closing_reports where id=$1',[s.report])).rows[0]).toEqual({received:0});
   await previous.db.exec(receivableFinancialSql());await admin(previous.db);const context=await financialContext(previous.db,s.receivable);expect(context).toMatchObject({requires_reconciliation:true,can_reconcile:true});
   await financialCommand(previous.db,{version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:'cf630000-0000-4000-8000-000000000001',receivable_id:s.receivable,expected_revision:context.revision,action:'reconcile',reason:'Conciliar saldo com lançamento bancário preservado'});
   expect(await financialContext(previous.db,s.receivable)).toMatchObject({requires_reconciliation:false,received_cents:1000});expect((await previous.db.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:1});
  }finally{await previous.db.close();}
 });
 it('does not accept legacy bank evidence whose account belongs to another tenant',async()=>{
  const previous=await createReceivableFinancialDatabase(false);try{
   await previous.db.exec('begin');const s=await createFinancialScenario(previous.db);await operationRpc(previous.db,'select register_receivable_payment($1,10,clock_timestamp(),$2)',[s.receivable,s.bank]);
   await previous.db.query('update bank_accounts set tenant_id=$1 where id=$2',[i.otherTenant,s.bank]);await previous.db.exec(receivableFinancialSql());await admin(previous.db);
   expect(await financialContext(previous.db,s.receivable)).toMatchObject({requires_reconciliation:true,can_reconcile:false,can_receive:false,can_reverse:false});
  }finally{await previous.db.close();}
 });
});
