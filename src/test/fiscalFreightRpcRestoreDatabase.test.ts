// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const integrityMigration = readFileSync('supabase/migrations/20260926185847_enforce_fiscal_document_load_tenant.sql', 'utf8');
const migration = readFileSync('supabase/migrations/20260926185848_restore_fiscal_freight_rpcs.sql', 'utf8');
const tenant = '00000000-0000-4000-8000-000000000201';
const otherTenant = '00000000-0000-4000-8000-000000000202';
const actor = '00000000-0000-4000-8000-000000000203';
const outsider = '00000000-0000-4000-8000-000000000204';
const load = '00000000-0000-4000-8000-000000000205';
const otherLoad = '00000000-0000-4000-8000-000000000211';
const client = '00000000-0000-4000-8000-000000000206';
const inbound = '00000000-0000-4000-8000-000000000207';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as $$
      select nullif(current_setting('test.uid', true), '')::uuid
    $$;
    select set_config('test.uid','${actor}',false);
    create table public.tenant_memberships(user_id uuid,tenant_id uuid,active boolean,role text);
    create function public.is_tenant_operator_or_admin(_tenant_id uuid)
      returns boolean language sql stable security definer set search_path='' as $$
      select exists(select 1 from public.tenant_memberships m
        where m.user_id=auth.uid() and m.tenant_id=_tenant_id and m.active
          and m.role in ('owner','admin','operator'))
    $$;
    create table public.loads(id uuid primary key,tenant_id uuid not null);
    create table public.clients(id uuid primary key,tenant_id uuid,company_name text);
    create table public.orders(id uuid primary key,tenant_id uuid,client_id uuid,order_number text);
    create table public.load_orders(id uuid primary key,tenant_id uuid,load_id uuid,order_id uuid);
    create table public.fiscal_documents(
      id uuid primary key default gen_random_uuid(),tenant_id uuid not null,created_by uuid,
      document_type text not null,status text not null default 'pending',load_id uuid,
      client_id uuid,invoice_number text,issue_date date,recipient text,recipient_cnpj text,
      recipient_state text,recipient_city text,recipient_neighborhood text,
      pallet_count numeric,weight_kg numeric,value numeric,freight_value numeric,
      freight_value_original numeric,freight_table_id uuid,freight_breakdown jsonb,
      cbs_base numeric,cbs_rate numeric,cbs_value numeric,ibs_base numeric,ibs_rate numeric,
      ibs_value numeric,freight_overridden boolean not null default false,
      updated_at timestamptz not null default now()
    );
    create table public.freight_calculation_log(
      id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,entity_id uuid,
      region_id uuid,region_name text,freight_table_id uuid,freight_table_name text,
      matched_criteria jsonb,ignored_criteria jsonb,components jsonb,base_value numeric,
      final_value numeric,is_override boolean,fallback_used boolean,fallback_reason text,
      created_by uuid,created_at timestamptz default now()
    );
    create unique index uq_freight_calculation_log_entity
      on public.freight_calculation_log(tenant_id,entity_type,entity_id);
    create table public.current_load_items(
      id uuid primary key,tenant_id uuid,load_id uuid,fiscal_document_id uuid,
      item_description text,pallet_count numeric,weight_kg numeric
    );
    insert into public.tenant_memberships values('${actor}','${tenant}',true,'operator');
    insert into public.loads values('${load}','${tenant}'),('${otherLoad}','${otherTenant}');
    insert into public.clients values('${client}','${tenant}','Cliente QA');
    insert into public.orders values('00000000-0000-4000-8000-000000000208','${tenant}','${client}','PED-01');
    insert into public.load_orders values
      ('00000000-0000-4000-8000-000000000209','${tenant}','${load}','00000000-0000-4000-8000-000000000208');
    insert into public.fiscal_documents
      (id,tenant_id,document_type,status,load_id,client_id,invoice_number,issue_date,value,
       recipient,recipient_cnpj,recipient_state,recipient_city,recipient_neighborhood)
      values('${inbound}','${tenant}','inbound','confirmed','${load}','${client}',
        'NF-01','2026-09-25',1000,'Destino','12345678000190','MG','Montes Claros','Centro');
    insert into public.current_load_items values
      ('00000000-0000-4000-8000-000000000210','${tenant}','${load}','${inbound}','Caixas',2,120);
  `);
  await db.exec(integrityMigration);
  await db.exec(migration);
}, 30_000);
afterAll(async () => db?.close());

describe('published fiscal freight RPC restoration', () => {
  it('installs exactly the callable operator surface and leaves it stable on reapply', async () => {
    const signatures = [
      'public.create_fiscal_document_with_freight_v1(uuid,jsonb,jsonb)',
      'public.update_fiscal_document_with_freight_v1(uuid,uuid,timestamptz,jsonb,jsonb,jsonb)',
      'public.get_load_freight_context_v1(uuid,uuid)',
    ];
    for (const signature of signatures) {
      const result = await db.query<{
        exists: boolean; security_definer: boolean; config: string[];
        anon: boolean; authenticated: boolean;
      }>(`select to_regprocedure($1) is not null as exists,
          p.prosecdef as security_definer,p.proconfig as config,
          has_function_privilege('anon',$1,'execute') as anon,
          has_function_privilege('authenticated',$1,'execute') as authenticated
        from pg_proc p where p.oid=to_regprocedure($1)`, [signature]);
      expect(result.rows).toEqual([{
        exists: true, security_definer: true, config: ['search_path=""'],
        anon: false, authenticated: true,
      }]);
    }
    const before = (await db.query<{ name: string; body: string }>(
      "select proname name, prosrc body from pg_proc where proname like '%fiscal_document_with_freight_v1' or proname='get_load_freight_context_v1' order by proname"
    )).rows;
    await db.exec(migration);
    expect((await db.query(
      "select proname name, prosrc body from pg_proc where proname like '%fiscal_document_with_freight_v1' or proname='get_load_freight_context_v1' order by proname"
    )).rows).toEqual(before);
  });

  it('reads only the requested tenant load and rejects other actors', async () => {
    const context = (await db.query<{ value: {
      documents: Array<{ id: string }>; item_descriptions: string[]; order_names: string[];
      total_pallets: number; total_weight: number;
    } }>('select public.get_load_freight_context_v1($1,$2) value', [tenant, load])).rows[0].value;
    expect(context.documents.map(document => document.id)).toEqual([inbound]);
    expect(context.item_descriptions).toEqual(['Caixas']);
    expect(context.order_names).toEqual(['PED-01']);
    expect(Number(context.total_pallets)).toBe(2);
    expect(Number(context.total_weight)).toBe(120);
    await expect(db.query('select public.get_load_freight_context_v1($1,$2)', [otherTenant, load]))
      .rejects.toThrow('load_freight_context_not_authorized');
    await db.query('select set_config($1,$2,false)', ['test.uid', outsider]);
    try {
      await expect(db.query('select public.get_load_freight_context_v1($1,$2)', [tenant, load]))
        .rejects.toThrow('load_freight_context_not_authorized');
    } finally {
      await db.query('select set_config($1,$2,false)', ['test.uid', actor]);
    }
  });

  it('creates and updates the outbound document atomically with its freight audit', async () => {
    const breakdown = { regionName: 'Norte de Minas', baseValue: 100, finalValue: 120,
      matchedCriteria: [], ignoredCriteria: [], components: {}, fallbackUsed: false };
    const payload = { document_type: 'outbound', status: 'confirmed', load_id: load,
      client_id: client, invoice_number: 'CTE-QA', value: 120, freight_value: 120,
      freight_value_original: 120, freight_breakdown: breakdown };
    const created = (await db.query<{ value: { id: string; updated_at: string } }>(
      'select public.create_fiscal_document_with_freight_v1($1,$2::jsonb,$3::jsonb) value',
      [tenant, JSON.stringify(payload), JSON.stringify(breakdown)])).rows[0].value;
    expect(created.id).toBeTruthy();
    const firstLog = await db.query<{ final_value: number }>(
      'select final_value from public.freight_calculation_log where tenant_id=$1 and entity_id=$2',
      [tenant, created.id]);
    expect(Number(firstLog.rows[0].final_value)).toBe(120);

    const freight = { freight_value: 150, freight_value_original: 150, value: 150,
      freight_breakdown: breakdown };
    const revised = (await db.query<{ value: { recipient_city: string; freight_value: number } }>(
      'select public.update_fiscal_document_with_freight_v1($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb) value',
      [tenant, created.id, created.updated_at, JSON.stringify({ recipient_city: 'Belo Horizonte' }),
        JSON.stringify(freight), JSON.stringify({ ...breakdown, finalValue: 150 })])).rows[0].value;
    expect(revised.recipient_city).toBe('Belo Horizonte');
    expect(Number(revised.freight_value)).toBe(150);
    const log = await db.query<{ count: number; final_value: number }>(
      'select count(*)::int count,max(final_value) final_value from public.freight_calculation_log where entity_id=$1',
      [created.id]);
    expect(log.rows[0].count).toBe(1);
    expect(Number(log.rows[0].final_value)).toBe(150);
    await expect(db.query(
      'select public.update_fiscal_document_with_freight_v1($1,$2,$3,$4::jsonb,$5::jsonb,$6::jsonb)',
      [tenant, created.id, created.updated_at, '{}', JSON.stringify(freight), JSON.stringify(breakdown)]))
      .rejects.toThrow('fiscal_document_changed');
  });

  it('rolls back document creation when the freight audit cannot be written', async () => {
    const before = (await db.query<{ count: number }>(
      "select count(*)::int count from public.fiscal_documents where invoice_number='CTE-ROLLBACK'"
    )).rows[0].count;
    await expect(db.query(
      'select public.create_fiscal_document_with_freight_v1($1,$2::jsonb,$3::jsonb)',
      [tenant, JSON.stringify({ document_type: 'outbound', invoice_number: 'CTE-ROLLBACK' }),
        JSON.stringify({ regionId: 'invalid-uuid' })])).rejects.toThrow();
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.fiscal_documents where invoice_number='CTE-ROLLBACK'"
    )).rows[0].count).toBe(before);
  });

  it('rejects a fiscal writer payload referencing another tenant load', async () => {
    const before = (await db.query<{ count: number }>(
      "select count(*)::int count from public.fiscal_documents where invoice_number='CTE-CROSS-TENANT'"
    )).rows[0].count;
    await expect(db.query(
      'select public.create_fiscal_document_with_freight_v1($1,$2::jsonb,$3::jsonb)',
      [tenant, JSON.stringify({ document_type: 'outbound', invoice_number: 'CTE-CROSS-TENANT',
        load_id: otherLoad }), '{}'])).rejects.toThrow();
    expect((await db.query<{ count: number }>(
      "select count(*)::int count from public.fiscal_documents where invoice_number='CTE-CROSS-TENANT'"
    )).rows[0].count).toBe(before);
  });
});
