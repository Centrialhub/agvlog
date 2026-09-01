import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const loadImportMigration = '20260901143218_make_load_import_atomic.sql';
export const loadImportSql = () => readFileSync(`supabase/migrations/${loadImportMigration}`, 'utf8');
export const loadImportIds = {
  tenant: 'd1100000-0000-4000-8000-000000000001',
  otherTenant: 'd1100000-0000-4000-8000-000000000002',
  operator: 'd1100000-0000-4000-8000-000000000003',
  driver: 'd1100000-0000-4000-8000-000000000004',
  request: 'd1100000-0000-4000-8000-000000000005',
  paidLoad: 'd1100000-0000-4000-8000-000000000006',
  payment: 'd1100000-0000-4000-8000-000000000007',
};

const fixture = `
create role anon nologin; create role authenticated nologin; create role service_role nologin;
create schema auth; create schema private;
grant usage on schema public,auth to authenticated;
create function auth.uid() returns uuid language sql stable as $$
 select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid
$$;
create table public.tenants(id uuid primary key);
create table public.tenant_memberships(tenant_id uuid not null,user_id uuid not null,role text not null,active boolean not null default true,
 primary key(tenant_id,user_id));
create function public.is_tenant_operator_or_admin(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$
 select exists(select 1 from public.tenant_memberships where tenant_id=_tenant and user_id=auth.uid() and active and role in('owner','admin','operator'))
$$;
grant execute on function public.is_tenant_operator_or_admin(uuid),auth.uid() to authenticated;

create table public.loads(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,load_number text not null,external_load_number text,
 status text not null default 'planned',load_date date,arrival_date date,closed_at timestamptz,expected_payment_date date,payment_date date,
 operational_status text,billing_status text,payment_status text not null default 'unpaid',gross_cargo_value numeric(14,2) not null default 0,
 freight_amount numeric(14,2) not null default 0,received_amount numeric(14,2) not null default 0,total_weight_kg numeric default 0,
 invoice_count integer not null default 0,cte_count integer not null default 0,legacy_status_text text,source_origin text,last_import_batch_id uuid,
 receivable_id uuid,client_invoice_id uuid,doccob_export_id uuid,created_by uuid,created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),version integer not null default 1,unique(tenant_id,external_load_number),unique(tenant_id,load_number),unique(tenant_id,id));
create table public.fiscal_documents(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,document_type text not null default 'inbound',invoice_number text,access_key text,
 remitter text,remitter_cnpj text,recipient text,recipient_cnpj text,issue_date date,load_id uuid,origin_city text,origin_state text,recipient_city text,recipient_state text,
 value numeric default 0,freight_value numeric default 0,weight_kg numeric default 0,volume_count numeric default 0,status text not null default 'pending',
 import_batch_id text,imported_at timestamptz,created_by uuid,current_delivery_attempt_id uuid,created_at timestamptz not null default now(),
 updated_at timestamptz not null default now(),unique(tenant_id,id));
create table public.load_documents(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,load_id uuid not null,fiscal_document_id uuid not null,
 document_type text not null default 'nfe',document_number text,access_key text,issue_date date,issuer_name text,issuer_cnpj text,
 recipient_name text,recipient_cnpj text,origin_city text,origin_state text,destination_city text,destination_state text,
 cargo_value numeric(14,2) not null default 0,freight_value numeric(14,2) not null default 0,weight_kg numeric(14,3) not null default 0,
 volume_count numeric(14,3) not null default 0,metadata jsonb not null default '{}',created_at timestamptz not null default now(),
 unique(load_id,fiscal_document_id));
create table public.load_import_batches(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,source_type text not null,file_name text,file_count integer not null default 0,
 parsed_count integer not null default 0,imported_count integer not null default 0,duplicated_count integer not null default 0,error_count integer not null default 0,
 status text not null default 'processing',metadata jsonb not null default '{}',errors jsonb not null default '[]',created_at timestamptz not null default now(),created_by uuid);
create table public.load_items(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,load_id uuid not null,fiscal_document_id uuid,item_description text not null default '',
 quantity numeric not null default 0,pallet_count integer not null default 0,weight_kg numeric default 0,volume_m3 numeric default 0,status text not null default 'pending',
 delivery_attempt_id uuid,created_at timestamptz not null default now(),updated_at timestamptz not null default now());
create table public.load_unloading_charges(
 id uuid primary key default gen_random_uuid(),tenant_id uuid not null,load_id uuid,fiscal_document_id uuid,invoice_number text,client_name text,
 supplier_name text,city text,service_date date,amount numeric(14,2) not null default 0,status text not null default 'pending',import_batch_id uuid,
 metadata jsonb not null default '{}',created_at timestamptz not null default now(),created_by uuid);
create table public.load_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,load_id uuid not null,amount numeric not null default 0);
`;

export async function createLoadImportDatabase(candidate = true) {
  const db = new PGlite();
  await db.exec(fixture);
  if (candidate) await db.exec(loadImportSql());
  return db;
}

export async function seedLoadImport(db: PGlite) {
  const i = loadImportIds;
  await db.query('insert into tenants(id) values($1),($2)', [i.tenant, i.otherTenant]);
  await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true),($1,$3,'driver',true)", [i.tenant, i.operator, i.driver]);
  await db.query(`insert into loads(id,tenant_id,load_number,external_load_number,status,operational_status,payment_status,
    freight_amount,received_amount,payment_date,receivable_id,version) values($1,$2,'PAID-1','PAID-1','delivered','delivered','paid',100,100,'2026-08-31',$3,7)`,
    [i.paidLoad, i.tenant, i.payment]);
  await db.query('insert into load_payments(id,tenant_id,load_id,amount) values($1,$2,$3,100)', [i.payment, i.tenant, i.paidLoad]);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
}

export function loadImportPayload(options: Record<string, unknown> = {}) {
  const i = loadImportIds;
  return {
    version: 1, tenant_id: i.tenant, actor_id: i.operator, request_id: i.request,
    source_type: 'spreadsheet', file_name: 'qa.xlsx', file_count: 1,
    loads: [{ external_load_number: 'QA-IMPORT-1', load_date: '2026-09-01', arrival_date: null,
      gross_cargo_cents: 10000, freight_cents: 1000, cte_count: 0, legacy_status_text: null,
      expected_payment_date: null, closed_at: null }],
    documents: [{ external_load_number: 'QA-IMPORT-1', kind: 'nfe', access_key: null, number: 'NF-1', issue_date: '2026-09-01',
      issuer_name: 'Fornecedor QA', issuer_cnpj: null, recipient_name: 'Cliente QA', recipient_cnpj: null,
      origin_city: null, origin_state: null, destination_city: 'São Paulo', destination_state: 'SP',
      cargo_cents: 10000, freight_cents: 1000, weight_grams: 5000, volume_milliunits: 1000,
      freight_rate_ppm: 100000, referenced_nfe_keys: [] }],
    unloading_charges: [{ external_load_number: 'QA-IMPORT-1', invoice_number: 'NF-1', client_name: 'Cliente QA',
      supplier_name: 'Fornecedor QA', city: 'São Paulo', service_date: '2026-09-01', amount_cents: 2500, suppliers: ['Fornecedor QA'] }],
    ...options,
  };
}

export async function applyLoadImport(db: PGlite, payload: unknown) {
  await db.exec('savepoint load_import_rpc;set role authenticated');
  try {
    const result = (await db.query<{ result: Record<string, unknown> }>('select public.apply_load_import_command($1::jsonb) result', [JSON.stringify(payload)])).rows[0].result;
    await db.exec('reset role;release savepoint load_import_rpc'); return result;
  } catch (error) {
    await db.exec('rollback to savepoint load_import_rpc;release savepoint load_import_rpc'); throw error;
  }
}
