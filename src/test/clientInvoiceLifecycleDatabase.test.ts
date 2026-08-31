// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createInvoiceLifecycleDatabase,createInvoiceScenario,invoiceContext,invoiceActionPayload,invoiceCommand,manualInvoiceDraft,directInvoicePayload,invoiceRequest,invoiceCreationContext,invoiceLifecycleSql} from './helpers/clientInvoiceLifecycleDatabase';
import {parseInvoiceList} from '@/lib/financial/clientInvoiceList';
import {parseFinancialContext} from '@/lib/financial/receivableCommands';
import {createFinancialScenario} from './helpers/receivableFinancialDatabase';
import {createClosingWithClient,closingAction,closingActionPayload} from './helpers/closingLifecycleDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
import {financialPayload,financialCommand,financialContext,reversalPayload} from './helpers/receivableFinancialDatabase';
let db:PGlite;beforeAll(async()=>{({db}=await createInvoiceLifecycleDatabase());},30000);beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const admin=async()=>db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
const bank=async()=>db.query('insert into bank_accounts(id,tenant_id,name) values($1,$2,$3)',['cf600000-0000-4000-8000-000000000001',i.tenant,'Banco QA']);
describe('audited invoice lifecycle and linked financial state',{timeout:15000},()=>{
 it('generates a closing invoice once and recovers the original confirmation',async()=>{
  const s=await createInvoiceScenario(db);const replay=await invoiceCommand(db,s.creation);expect(replay.invoice_id).toBe(s.invoice);expect((await db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:1});await db.exec('set constraints all immediate');
 });
 it('cancels invoice, receivable and closing atomically and releases claims without deleting evidence',async()=>{
  const s=await createInvoiceScenario(db);await admin();const p=await invoiceActionPayload(db,s.invoice);const ack=await invoiceCommand(db,p);expect(await invoiceCommand(db,p)).toEqual(ack);
  expect(await invoiceContext(db,s.invoice)).toMatchObject({status:'cancelled',requires_reconciliation:false,received_cents:0,open_cents:0,can_reactivate:true});
  expect((await db.query('select status,open_amount::float open from closing_reports where id=$1',[s.report])).rows[0]).toEqual({status:'cancelled',open:0});
  expect((await db.query('select count(*)::int n from closing_report_charge_claims where released_at is null')).rows[0]).toEqual({n:0});expect((await db.query('select count(*)::int n from client_invoice_charges')).rows[0]).toEqual({n:1});await db.exec('set constraints all immediate');
 });
 it('reactivates the same graph and keeps the previous cancelled claims in history',async()=>{
  const s=await createInvoiceScenario(db);await admin();await invoiceCommand(db,await invoiceActionPayload(db,s.invoice));await invoiceCommand(db,await invoiceActionPayload(db,s.invoice,'reactivate'));
  expect(await invoiceContext(db,s.invoice)).toMatchObject({status:'generated',requires_reconciliation:false,open_cents:24000});expect(await financialContext(db,s.receivable)).toMatchObject({can_receive:true,requires_reconciliation:false});
  expect((await db.query('select count(*)::int n from closing_report_charge_claims where released_at is not null')).rows[0]).toEqual({n:3});expect((await db.query('select count(*)::int n from closing_report_charge_claims where released_at is null')).rows[0]).toEqual({n:3});
 });
 it('refuses cancellation with net receipts and permits it after an audited compensating reversal',async()=>{
  const s=await createInvoiceScenario(db);await admin();await bank();const receipt=await financialCommand(db,await financialPayload(db,s.receivable));
  await expect(invoiceCommand(db,await invoiceActionPayload(db,s.invoice))).rejects.toThrow('valid_state');
  await financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),receipt.payment_id!));await invoiceCommand(db,await invoiceActionPayload(db,s.invoice));
  expect((await db.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:2});expect(await invoiceContext(db,s.invoice)).toMatchObject({status:'cancelled',received_cents:0});
 });
 it('records an actual send on a paid invoice without reverting its financial status',async()=>{
  const s=await createInvoiceScenario(db);await bank();await financialCommand(db,await financialPayload(db,s.receivable,{amount_cents:24000}));
  const p={...await invoiceActionPayload(db,s.invoice,'mark_sent'),channel:'manual',sent_to:'Financeiro QA'};await invoiceCommand(db,p);expect(await invoiceContext(db,s.invoice)).toMatchObject({status:'paid',received_cents:24000,requires_reconciliation:false});
 });
 it('refuses the legacy cancel and direct invoice updates after the cutover',async()=>{
  const s=await createInvoiceScenario(db);await expect(operationRpc(db,'select cancel_client_invoice($1,$2)',[s.invoice,'Legado'])).rejects.toThrow('permission denied');
  await expect(operationRpc(db,"update client_invoices set status='paid' where id=$1",[s.invoice])).rejects.toThrow('permission denied');
 });
 it('generates a manual invoice exactly once, preserves its contract, and rejects reused keys with another body',async()=>{
  const draft=await manualInvoiceDraft(db);const p=await directInvoicePayload(db,draft);const first=await invoiceCommand(db,p);expect(await invoiceCommand(db,p)).toEqual(first);
  await expect(invoiceCommand(db,{...p,reason:'Outro motivo'})).rejects.toThrow('request');await admin();await invoiceCommand(db,await invoiceActionPayload(db,first.invoice_id));await invoiceCommand(db,await invoiceActionPayload(db,first.invoice_id,'reactivate'));
  expect(await invoiceContext(db,first.invoice_id)).toMatchObject({status:'generated',open_cents:10000,report_id:null,requires_reconciliation:false});expect((await db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:1});await db.exec('set constraints all immediate');
 });
 it('validates direct CT-e source price and rejects a second active invoice for the same source',async()=>{
  const base=await manualInvoiceDraft(db);const id=invoiceRequest();await db.query("insert into cte_documents(id,tenant_id,client_id,cte_number,freight_value,status,sefaz_status,is_voided) values($1,$2,$3,'QA-CTE',100,'authorized','authorized',false)",[id,i.tenant,base.client_id]);
  const draft={...base,charges:[{source_type:'cte_document',source_id:id,gross_amount:100,net_amount:100,sort_order:0}]};const p=await directInvoicePayload(db,draft);const ack=await invoiceCommand(db,p);
  await expect(invoiceCreationContext(db,null,draft)).rejects.toThrow('already_billed');await admin();await invoiceCommand(db,await invoiceActionPayload(db,ack.invoice_id));
  const replacement=await invoiceCommand(db,await directInvoicePayload(db,draft));await expect(invoiceCommand(db,await invoiceActionPayload(db,ack.invoice_id,'reactivate'))).rejects.toThrow('already_billed');expect(replacement.invoice_id).not.toBe(ack.invoice_id);
  expect((await db.query('select count(*)::int n from client_invoice_charges where cancelled_at is null')).rows[0]).toEqual({n:1});
 });
 it('rejects changed source facts after preview and on reactivation without replacing invoice history',async()=>{
  const base=await manualInvoiceDraft(db),id=invoiceRequest();await db.query("insert into cte_documents(id,tenant_id,client_id,cte_number,freight_value,status,is_voided) values($1,$2,$3,'QA-CHANGE',100,'authorized',false)",[id,i.tenant,base.client_id]);
  const draft={...base,charges:[{source_type:'cte_document',source_id:id,gross_amount:100,net_amount:100,sort_order:0}]};const p=await directInvoicePayload(db,draft);
  await db.query('update cte_documents set freight_value=101 where id=$1',[id]);await expect(invoiceCommand(db,p)).rejects.toThrow('source_changed');expect((await db.query('select count(*)::int n from client_invoices')).rows[0]).toEqual({n:0});
  await db.query('update cte_documents set freight_value=100 where id=$1',[id]);const ack=await invoiceCommand(db,p);await admin();await invoiceCommand(db,await invoiceActionPayload(db,ack.invoice_id));
  await db.query("update cte_documents set cte_number='QA-CHANGED' where id=$1",[id]);await expect(invoiceCommand(db,await invoiceActionPayload(db,ack.invoice_id,'reactivate'))).rejects.toThrow('source_changed');expect(await invoiceContext(db,ack.invoice_id)).toMatchObject({status:'cancelled'});
 });
 it('rolls every generated row back if recording the durable acknowledgement fails',async()=>{
  const draft=await manualInvoiceDraft(db),p=await directInvoicePayload(db,draft);await db.exec("create function qa_invoice_fail() returns trigger language plpgsql as $$ begin raise exception 'qa_invoice_late_failure';end;$$;create trigger qa_invoice_fail before insert on client_invoice_commands for each row execute function qa_invoice_fail();");
  await expect(invoiceCommand(db,p)).rejects.toThrow('qa_invoice_late_failure');for(const table of ['client_invoices','client_invoice_charges','receivables','client_invoice_commands'])expect((await db.query('select count(*)::int n from '+table)).rows[0]).toEqual({n:0});
 });
 it('refuses stale action context and revoked membership even on an already confirmed request',async()=>{
  const s=await createInvoiceScenario(db);await admin();const stale=await invoiceActionPayload(db,s.invoice);await invoiceCommand(db,{...await invoiceActionPayload(db,s.invoice,'mark_sent'),channel:'manual',sent_to:'QA'});await expect(invoiceCommand(db,stale)).rejects.toThrow('context_changed');
  await db.query("update tenant_memberships set active=false where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await expect(invoiceCommand(db,s.creation)).rejects.toThrow('not_authorized');
 });
 it('isolates raw tables and contexts from drivers and other tenants',async()=>{
  const s=await createInvoiceScenario(db);await db.query("update tenant_memberships set role='driver' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
  await expect(invoiceContext(db,s.invoice)).rejects.toThrow('not_authorized');await expect(operationRpc(db,'select list_client_invoice_financials($1)',[i.tenant])).rejects.toThrow('not_authorized');
  for(const table of ['client_invoices','client_invoice_charges','client_invoice_details','client_invoice_commands'])expect((await operationRpc(db,'select count(*)::int n from '+table)).rows[0]).toEqual({n:0});
  await expect(operationRpc(db,'select get_client_invoice_action_context($1,$2)',[i.otherTenant,s.invoice])).rejects.toThrow('not_authorized');
  await expect(operationRpc(db,'select _invoice_lifecycle_snapshot($1,$2)',[i.tenant,s.invoice])).rejects.toThrow('permission denied');
 });
 it('keeps partial receipts and cancellations balanced in the single-snapshot list',async()=>{
  const s=await createInvoiceScenario(db);await bank();const p=await financialCommand(db,await financialPayload(db,s.receivable));
  const list=async()=>parseInvoiceList((await operationRpc(db,'select list_client_invoice_financials($1) result',[i.tenant])).rows[0].result,i.tenant,i.operator);
  expect((await list()).rows[0]).toMatchObject({received_amount:10,open_amount:230,status:'generated',requires_reconciliation:false});await admin();await financialCommand(db,reversalPayload(await financialPayload(db,s.receivable),p.payment_id!));await invoiceCommand(db,await invoiceActionPayload(db,s.invoice));
  expect((await list()).rows[0]).toMatchObject({received_amount:0,open_amount:0,status:'cancelled',total_amount:240,requires_reconciliation:false});
  expect(parseFinancialContext(await financialContext(db,s.receivable),i.tenant,i.operator,s.receivable)).toMatchObject({open_cents:0,received_cents:0,can_receive:false});
 });
 it('does not reclaim sources already reserved by a replacement closing after cancellation',async()=>{
  const s=await createInvoiceScenario(db);await admin();await invoiceCommand(db,await invoiceActionPayload(db,s.invoice));const other=(await createClosingWithClient(db,invoiceRequest())).report.id;await closingAction(db,await closingActionPayload(db,other));
  await expect(invoiceCommand(db,await invoiceActionPayload(db,s.invoice,'reactivate'))).rejects.toThrow(/already_reserved|already_invoiced/);expect(await invoiceContext(db,s.invoice)).toMatchObject({status:'cancelled',open_cents:0});
 });
 it('repairs a legacy cancelled paid invoice only through explicit audited reactivation',async()=>{
  const legacy=(await createInvoiceLifecycleDatabase(false)).db;try{await legacy.exec('begin');const s=await createFinancialScenario(legacy);await financialCommand(legacy,await financialPayload(legacy,s.receivable,{amount_cents:24000}));
   await operationRpc(legacy,'select cancel_client_invoice($1,$2)',[s.invoice,'Cancelamento legado QA']);await legacy.exec(invoiceLifecycleSql());await legacy.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
   expect(await invoiceContext(legacy,s.invoice)).toMatchObject({requires_reconciliation:true,can_cancel:false,can_reactivate:true});await invoiceCommand(legacy,await invoiceActionPayload(legacy,s.invoice,'reactivate'));expect(await invoiceContext(legacy,s.invoice)).toMatchObject({status:'paid',received_cents:24000,requires_reconciliation:false});expect((await legacy.query('select count(*)::int n from bank_transactions')).rows[0]).toEqual({n:1});await legacy.exec('set constraints all immediate;rollback');
  }finally{await legacy.close();}
 });
 it('bills NFS-e using real cancellation fields and preserves gross commercial totals without reinterpreting withholding',async()=>{
  const base=await manualInvoiceDraft(db),id=invoiceRequest();await db.query("insert into nfse_documents(id,tenant_id,cliente_id,nfse_number,valor_total,valor_liquido,valor_ir,status,cancelled,is_preview) values($1,$2,$3,'QA-NFSE',100,97,3,'authorized',false,false)",[id,i.tenant,base.client_id]);
  const draft={...base,charges:[{source_type:'nfse_document',source_id:id,gross_amount:100,net_amount:97,ir_amount:3,sort_order:0}]};const p=await directInvoicePayload(db,draft);const ack=await invoiceCommand(db,p);expect(await invoiceContext(db,ack.invoice_id)).toMatchObject({amount_cents:10000,requires_reconciliation:false});await admin();await invoiceCommand(db,await invoiceActionPayload(db,ack.invoice_id));await db.query('update nfse_documents set cancelled=true where id=$1',[id]);await expect(invoiceCommand(db,await invoiceActionPayload(db,ack.invoice_id,'reactivate'))).rejects.toThrow('source_changed');
 });
 it('exposes orphan invoice state as needing reconciliation, without granting financial actions',async()=>{
  const base=await manualInvoiceDraft(db),id=invoiceRequest();await db.query("insert into client_invoices(id,tenant_id,client_id,invoice_number,status,total_amount) values($1,$2,$3,'QA-ORPHAN','generated',100)",[id,i.tenant,base.client_id]);expect(await invoiceContext(db,id)).toMatchObject({requires_reconciliation:true,can_cancel:false,can_mark_sent:false,can_reactivate:false});
  const list=parseInvoiceList((await operationRpc(db,'select list_client_invoice_financials($1) result',[i.tenant])).rows[0].result,i.tenant,i.operator);expect(list.rows[0]).toMatchObject({requires_reconciliation:true,received_amount:null,open_amount:null});
 });
});
