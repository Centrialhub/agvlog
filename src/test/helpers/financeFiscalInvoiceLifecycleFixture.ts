import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
// Extend the existing operational/receivable fixture with fiscal source fields.
// Production fiscal and financial functions are installed from their migrations.
export async function installFinanceFiscalInvoiceLifecycleFixture(db:PGlite){
 const invoice=readFileSync("supabase/migrations/20260830192908_audit_client_invoice_lifecycle.sql","utf8");
 for(const name of ["_receivable_ledger_evidence","_receivable_financial_snapshot"]){const start=invoice.indexOf("function public."+name+"("),end=invoice.indexOf("$fn$;",start)+5;await db.exec("create or replace "+invoice.slice(start,end));await db.exec("revoke all on function public."+name+"(uuid,uuid) from public,anon,authenticated,service_role");}
 await db.exec(`
 alter table clients add column if not exists company_name text,add column if not exists tax_id text;
 alter table receivables add column if not exists cte_document_id uuid,add column if not exists fiscal_document_id uuid;
 alter table cte_documents add column if not exists client_id uuid,add column if not exists net_value numeric,add column if not exists payer_cnpj text;
 create table nfse_documents(id uuid primary key,tenant_id uuid,cliente_id uuid,pagador_cnpj text,cliente_cnpj text,
  valor_servicos numeric,valor_liquido numeric,valor_total numeric,iss_retido boolean,valor_iss numeric,outras_retencoes numeric,
  valor_pis numeric,valor_cofins numeric,valor_inss numeric,valor_ir numeric,valor_csll numeric,fiscal_document_ids uuid[],is_preview boolean);
 create table hub_fiscal_emissions(id uuid primary key,tenant_id uuid,doc_type text,environment text,status text,dispatch_state text,
  hub_document_id text,id_integracao text,emitter_cnpj text,access_key text,authorization_protocol text,number text,series text,
  provider_document_version bigint,provider_effect_id text,provider_occurred_at timestamptz,request_payload jsonb,
  cte_document_id uuid,fiscal_document_id uuid,nfse_document_id uuid,message text);
 `);
 for(const file of ['20260910004550_finance_fiscal_observation_queue.sql','20260910005509_finance_fiscal_receivable_basis.sql',
  '20260910010034_finance_fiscal_receivable_projection.sql','20260910011121_finance_fiscal_cancellation_credits.sql','20260910012152_finance_receivable_fiscal_context.sql']){
  await db.exec(readFileSync(file.includes('011121')?'supabase/rollouts/finance_fiscal_cancellation_credits_invoice_lifecycle.sql':'supabase/migrations/'+file,'utf8'));
 }
}
