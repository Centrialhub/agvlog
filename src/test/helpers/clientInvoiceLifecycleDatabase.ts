import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {createReceivableFinancialDatabase} from './receivableFinancialDatabase.ts';
import {operationIds as i,operationRpc} from './operationOutcomeDatabase.ts';
import {createClosingWithClient,closingAction,closingActionPayload} from './closingLifecycleDatabase.ts';
export const invoiceLifecycleMigration='20260830192908_audit_client_invoice_lifecycle.sql';
export const invoiceLifecycleSql=()=>readFileSync('supabase/migrations/'+invoiceLifecycleMigration,'utf8');
export async function installInvoiceLifecycleFixture(db:PGlite){
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8').replace(/\r\n/g,'\n');
 if(!(await db.query<{present:boolean}>("select to_regclass('public.nfse_documents') is not null present")).rows[0].present){
  const table=baseline.match(/CREATE TABLE public\.nfse_documents \([\s\S]*?\n\);/)?.[0];if(!table)throw new Error('Missing NFS-e baseline');await db.exec(table);
  for(const match of baseline.matchAll(/ALTER TABLE ONLY public\.nfse_documents\n {4}ALTER COLUMN[\s\S]*?;/g))await db.exec(match[0]);await db.exec('alter table public.nfse_documents add primary key(id)');
 }
 for(const name of ['ux_charges_active_source','ux_client_invoices_tenant_number']){
  if(!(await db.query<{present:boolean}>('select to_regclass($1) is not null present',['public.'+name])).rows[0].present){const sql=baseline.match(new RegExp('CREATE UNIQUE INDEX '+name+' [^;]+;'))?.[0];if(!sql)throw new Error('Missing real unique index');await db.exec(sql);}
 }
 for(const table of ['client_invoices','client_invoice_charges','client_invoice_details']){
  await db.exec('alter table public.'+table+' enable row level security;grant select,insert,update,delete on public.'+table+' to authenticated,service_role;');
  for(const policy of baseline.matchAll(new RegExp('CREATE POLICY [^\n]+ ON public\\.'+table+' [^\n]+;','g')))await db.exec(policy[0]);
 }
}
export async function createInvoiceLifecycleDatabase(candidate=true){const value=await createReceivableFinancialDatabase();await installInvoiceLifecycleFixture(value.db);if(candidate)await value.db.exec(invoiceLifecycleSql());return value;}
export interface InvoiceActionContext {revision:string;invoice_id:string;report_id:string|null;receivable_id:string;invoice_number:string;status:string;amount_cents:number;received_cents:number;open_cents:number;requires_reconciliation:boolean;can_cancel:boolean;can_reactivate:boolean;can_mark_sent:boolean}
export async function invoiceContext(db:PGlite,id:string){return (await operationRpc<{result:InvoiceActionContext}>(db,'select get_client_invoice_action_context($1,$2) result',[i.tenant,id])).rows[0].result;}
export async function invoiceCreationContext(db:PGlite,report:string|null,draft:unknown=null){return (await operationRpc<{result:{revision:string;can_generate:boolean}}>(db,'select get_client_invoice_creation_context($1,$2,$3::jsonb) result',[i.tenant,report,draft===null?null:JSON.stringify(draft)])).rows[0].result;}
let sequence=1;export function invoiceRequest(){return 'ce100000-0000-4000-8000-'+String(sequence++).padStart(12,'0');}
export async function invoiceActionPayload(db:PGlite,id:string,action='cancel'){return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:invoiceRequest(),invoice_id:id,action,reason:'Conferência de fatura QA',expected_revision:(await invoiceContext(db,id)).revision};}
export async function invoiceCommand(db:PGlite,payload:unknown){return (await operationRpc<{result:{invoice_id:string;receivable_id:string;status:string;command_id:string;revision:string}}>(db,'select apply_client_invoice_command($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result;}
export async function closingInvoicePayload(db:PGlite,report:string){return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:invoiceRequest(),report_id:report,action:'generate_closing',reason:'Faturamento conferido QA',expected_revision:(await invoiceCreationContext(db,report)).revision};}
export async function createInvoiceScenario(db:PGlite){const report=(await createClosingWithClient(db)).report.id;await closingAction(db,await closingActionPayload(db,report));const creation=await closingInvoicePayload(db,report);const ack=await invoiceCommand(db,creation);return {report,invoice:ack.invoice_id,receivable:ack.receivable_id,creation};}
export async function manualInvoiceDraft(db:PGlite){const client=(await db.query<{id:string}>('select id from clients where tenant_id=$1 order by id limit 1',[i.tenant])).rows[0].id;
 return {tenant_id:i.tenant,client_id:client,issue_date:'2026-08-30',due_date:null,discount_amount:0,interest_amount:0,notes:null,charges:[{source_type:'manual_service' as const,description:'Serviço sintético QA',gross_amount:100,net_amount:100,sort_order:0}]};}
export async function directInvoicePayload(db:PGlite,draft:unknown){return {version:1,tenant_id:i.tenant,actor_id:i.operator,request_id:invoiceRequest(),action:'generate',reason:'Faturamento sintético QA',draft,expected_revision:(await invoiceCreationContext(db,null,draft)).revision};}
