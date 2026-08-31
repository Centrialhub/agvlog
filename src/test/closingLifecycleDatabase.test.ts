// @vitest-environment node
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createClosingLifecycleDatabase,closingAction,closingActionPayload,closingActionContext,createClosingWithClient,seedClosingChargeFixture,closingChargeFixtureIds} from './helpers/closingLifecycleDatabase';
import {closingDraftPayload,createClosingDraft} from './helpers/closingDraftDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {ownerStatement,seedUndelivered} from './helpers/deliveryAttemptDatabase';
import {redeliveryPayload,requestRedelivery} from './helpers/redeliveryDatabase';
import {seedClosingCte,closingSources} from './helpers/closingSourcesDatabase';
let db:PGlite;let stop:string;
beforeAll(async()=>{({db,stop}=await createClosingLifecycleDatabase());},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const draft=async(key='cf000000-0000-4000-8000-000000000001')=>createClosingDraft(db,{...await closingDraftPayload(db),request_id:key});
const activeClaims=async()=>Number((await db.query<{n:number}>('select count(*)::int n from closing_report_charge_claims where released_at is null')).rows[0].n);
describe('audited closing lifecycle and charge ownership',{timeout:15000},()=>{
 it('uses independent billable sources without weakening historical review flags in the native fixture',async()=>{
  await seedClosingChargeFixture(db);const day=(await db.query<{qa_day:string}>("select to_char(clock_timestamp() at time zone 'America/Sao_Paulo','YYYY-MM-DD') as qa_day")).rows[0].qa_day;
  const filters={period_start:day,period_end:day,client_id:closingChargeFixtureIds.client};const source=await closingSources(db,filters) as {revision:string};const base=await closingDraftPayload(db);
  const r=await createClosingDraft(db,{...base,header:{...base.header,period_start:day,period_end:day,client_id:closingChargeFixtureIds.client},system:{...base.system,filters,revision:source.revision}});
  expect(r.totals.total_freight_value).toBe(100);expect(await closingActionContext(db,r.report.id)).toMatchObject({source_review_required:false});
  await closingAction(db,await closingActionPayload(db,r.report.id));expect(await activeClaims()).toBe(2);
 });
 it('closes once with three source claims, audit and durable response',async()=>{
  const r=await draft();const payload=await closingActionPayload(db,r.report.id);const ack=await closingAction(db,payload);
  expect(ack).toMatchObject({status:'closed',revision:1,changed:true});expect(await activeClaims()).toBe(3);expect(await closingAction(db,payload)).toEqual(ack);
  expect((await db.query("select count(*)::int n from closing_report_history where action='lifecycle_close'")).rows[0]).toEqual({n:1});
 });
 it('rolls back the status and all claims when final acknowledgement persistence fails',async()=>{
  const r=await draft();await db.exec("create function qa_fail_action() returns trigger language plpgsql as $$begin raise exception 'QA action failure';end;$$;create trigger qa_fail_action before insert on closing_report_action_requests for each row execute function qa_fail_action();");
  await expect(closingAction(db,await closingActionPayload(db,r.report.id))).rejects.toThrow('QA action failure');expect(await activeClaims()).toBe(0);
  expect(await closingActionContext(db,r.report.id)).toMatchObject({status:'draft',revision:0});
 });
 it('does not close a second report with the same billable attempt',async()=>{
  const first=await draft(),second=await draft('cf000000-0000-4000-8000-000000000002');await closingAction(db,await closingActionPayload(db,first.report.id));
  await expect(closingAction(db,await closingActionPayload(db,second.report.id))).rejects.toThrow('already_reserved');expect(await activeClaims()).toBe(3);
  expect(await closingActionContext(db,second.report.id)).toMatchObject({status:'draft',revision:0});
 });
 it('cancels an unbilled closing, retains released claims and permits another report to claim',async()=>{
  const first=await draft(),second=await draft('cf000000-0000-4000-8000-000000000002');await closingAction(db,await closingActionPayload(db,first.report.id));
  await closingAction(db,await closingActionPayload(db,first.report.id,'cancel'));expect(await activeClaims()).toBe(0);
  expect((await db.query('select count(*)::int n from closing_report_charge_claims where released_at is not null')).rows[0]).toEqual({n:3});
  await closingAction(db,await closingActionPayload(db,second.report.id));expect(await activeClaims()).toBe(3);
  await expect(ownerStatement(db,'delete from closing_report_charge_claims')).rejects.toThrow('immutable');
 });
 it('permits audited admin reopening and keeps the original request response unchanged',async()=>{
  const r=await draft();const payload=await closingActionPayload(db,r.report.id);const ack=await closingAction(db,payload);
  await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
  await closingAction(db,await closingActionPayload(db,r.report.id,'reopen'));expect(await activeClaims()).toBe(0);expect(await closingAction(db,payload)).toEqual(ack);
  expect(await closingActionContext(db,r.report.id)).toMatchObject({status:'reviewing',revision:2});
 });
 it('denies operator reopening, stale revisions and request-key reuse',async()=>{
  const r=await draft();const p=await closingActionPayload(db,r.report.id);await closingAction(db,p);
  await expect(closingAction(db,{...p,reason:'Motivo diferente'})).rejects.toThrow('key_mismatch');
  await expect(closingAction(db,{...await closingActionPayload(db,r.report.id,'cancel'),expected_revision:0})).rejects.toThrow('context_changed');
  await expect(closingAction(db,await closingActionPayload(db,r.report.id,'reopen'))).rejects.toThrow('not_authorized');
 });
 it('refuses legacy close/cancel/reopen/send RPCs and all direct claim/request DML',async()=>{
  const r=await draft();await expect(operationRpc(db,'select close_closing_report($1)',[r.report.id])).rejects.toThrow('permission denied');
  for(const table of ['closing_report_charge_claims','closing_report_action_requests'])expect((await db.query("select has_table_privilege('authenticated',$1,'INSERT,UPDATE,DELETE') allowed",[table])).rows[0]).toEqual({allowed:false});
 });
 it('prevents legacy state regression after a close, including paid-to-closed',async()=>{
  const r=await draft();await closingAction(db,await closingActionPayload(db,r.report.id));
  await expect(ownerStatement(db,`update closing_reports set status='draft' where id='${r.report.id}'`)).rejects.toThrow('invalid_state_transition');
  await expect(ownerStatement(db,`update closing_reports set status='paid' where id='${r.report.id}'`)).rejects.toThrow('invalid_payment_state');
 });
 it('keeps unpriced redelivery under financial review with no claims',async()=>{
  await seedUndelivered(db,stop);await requestRedelivery(db,await redeliveryPayload(db));const r=await draft();
  await expect(closingAction(db,await closingActionPayload(db,r.report.id))).rejects.toThrow('financial_review_required');expect(await activeClaims()).toBe(0);
 });
 it('does not register a second identical send and never sends a message externally',async()=>{
  const r=await draft();await closingAction(db,await closingActionPayload(db,r.report.id));
  await closingAction(db,{...await closingActionPayload(db,r.report.id,'mark_sent'),sent_to:'Financeiro',channel:'manual'});
  const ack=await closingAction(db,{...await closingActionPayload(db,r.report.id,'mark_sent'),sent_to:'Financeiro',channel:'manual'});
  expect(ack).toMatchObject({status:'sent',revision:2,changed:false});
 });
 it('denies cross-tenant and driver commands and hides action history through RLS',async()=>{
  const r=await draft();const p=await closingActionPayload(db,r.report.id);await closingAction(db,p);
  await expect(closingAction(db,{...p,tenant_id:i.otherTenant})).rejects.toThrow('not_authorized');await db.query("select set_config('request.jwt.claim.sub',$1,false)",[i.user]);
  await expect(closingAction(db,p)).rejects.toThrow('not_authorized');expect((await operationRpc(db,'select * from closing_report_action_requests')).rows).toEqual([]);
 });
 it('generates the real canonical invoice after closing and refuses cancelling linked finance',async()=>{
  const r=await createClosingWithClient(db);await closingAction(db,await closingActionPayload(db,r.report.id));
  await operationRpc(db,'select generate_client_invoice_from_closing($1)',[r.report.id]);
  expect(await closingActionContext(db,r.report.id)).toMatchObject({status:'invoiced',revision:2});
  await expect(closingAction(db,await closingActionPayload(db,r.report.id,'cancel'))).rejects.toThrow('financial_reconciliation');
  expect((await db.query('select count(*)::int n from receivables')).rows[0]).toEqual({n:1});
 });
 it('blocks invoicing a CT-e through the other module after its delivery is reserved',async()=>{
  await seedClosingCte(db);const r=await draft();await closingAction(db,await closingActionPayload(db,r.report.id));
  const cte=(await db.query<{id:string}>('select id from cte_documents limit 1')).rows[0].id;
  await expect(ownerStatement(db,`insert into client_invoice_charges(tenant_id,invoice_id,source_type,source_id) values('${i.tenant}','cf200000-0000-4000-8000-000000000001','cte_document','${cte}')`)).rejects.toThrow('already_reserved');
 });
 it('preserves partial and final collection through the real receivable and bank ledgers',async()=>{
  const r=await createClosingWithClient(db);await closingAction(db,await closingActionPayload(db,r.report.id));await operationRpc(db,'select generate_client_invoice_from_closing($1)',[r.report.id]);
  const bank='cf300000-0000-4000-8000-000000000001';await db.query('insert into bank_accounts(id,tenant_id,name) values($1,$2,$3)',[bank,i.tenant,'QA local']);
  const pay=async(amount:number)=>operationRpc(db,'select register_closing_report_payment($1,$2::jsonb)',[r.report.id,JSON.stringify({amount,bank_account_id:bank,payment_method:'other',notes:'QA sem movimentação externa'})]);
  await pay(10);expect(await closingActionContext(db,r.report.id)).toMatchObject({status:'partially_paid',revision:3});
  const remaining=(await db.query<{amount:number}>('select open_amount::float amount from closing_reports where id=$1',[r.report.id])).rows[0].amount;
  await pay(remaining);expect(await closingActionContext(db,r.report.id)).toMatchObject({status:'paid',revision:4});
  expect((await db.query('select r.received_amount=c.received_amount and c.open_amount=0 matched from closing_reports c join receivables r on r.id=c.receivable_id where c.id=$1',[r.report.id])).rows[0]).toEqual({matched:true});
  for(const table of ['closing_report_payments','receivables_payments','bank_transactions'])expect((await db.query('select count(*)::int n from '+table)).rows[0]).toEqual({n:2});
  await expect(ownerStatement(db,`update closing_reports set status='closed' where id='${r.report.id}'`)).rejects.toThrow('invalid_state_transition');
 });
 it('refuses removing linked finance or forging receipt totals without the canonical ledger',async()=>{
  const r=await createClosingWithClient(db);await closingAction(db,await closingActionPayload(db,r.report.id));await operationRpc(db,'select generate_client_invoice_from_closing($1)',[r.report.id]);
  for(const field of ['receivable_id','client_invoice_id'])await expect(ownerStatement(db,`update closing_reports set ${field}=null where id='${r.report.id}'`)).rejects.toThrow('financial_links_are_immutable');
  await expect(ownerStatement(db,`update closing_reports set received_amount=1,open_amount=total_amount-1 where id='${r.report.id}'`)).rejects.toThrow('financial_ledger_requires_reconciliation');
  await expect(ownerStatement(db,`delete from client_invoices where id=(select client_invoice_id from closing_reports where id='${r.report.id}')`)).rejects.toThrow();
  expect(await closingActionContext(db,r.report.id)).toMatchObject({status:'invoiced',revision:2});
 });
 it('validates the action envelope and keeps every new helper private',async()=>{
  const r=await draft(),p=await closingActionPayload(db,r.report.id);
  for(const patch of [{reason:'x'},{expected_revision:-1},{expected_revision:1.5},{unexpected:true},{action:'delete'},{sent_to:null}])await expect(closingAction(db,{...p,...patch})).rejects.toThrow('invalid_');
  const helpers=['_preserve_closing_charge_claim()','_claim_closing_delivery_charges(uuid)','_guard_closing_lifecycle_state()','_release_closing_delivery_charges()','_guard_fiscal_invoice_closing_claim()'];
  for(const helper of helpers)for(const role of ['anon','authenticated','service_role'])expect((await db.query('select has_function_privilege($1,$2,\'execute\') allowed',[role,helper])).rows[0]).toEqual({allowed:false});
  expect(await activeClaims()).toBe(0);
 });
});
