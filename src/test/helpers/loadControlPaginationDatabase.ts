import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const loadControlPaginationMigration = '20260901203000_add_keyset_load_control_reader.sql';
export const loadControlPaginationSql = () => readFileSync(
  `supabase/migrations/${loadControlPaginationMigration}`,
  'utf8',
);

export const loadControlIds = {
  tenant: '20000000-0000-4000-8000-000000000001',
  otherTenant: '20000000-0000-4000-8000-000000000002',
  operator: '10000000-0000-4000-8000-000000000001',
};

export interface LoadControlDatabasePage {
  version: number;
  tenant_id: string;
  actor_id: string;
  items: Array<Record<string, unknown>>;
  total_count: number;
  summary: Record<string, number>;
  next_cursor: Record<string, unknown> | null;
}

export async function createLoadControlPaginationDatabase() {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;

    create function auth.uid() returns uuid language sql stable as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table public.tenant_memberships(
      tenant_id uuid not null,
      user_id uuid not null,
      role text not null,
      active boolean not null default true
    );
    create table public.drivers(
      id uuid primary key,
      tenant_id uuid not null,
      name text
    );
    create table public.vehicles(
      id uuid primary key,
      tenant_id uuid not null,
      plate text
    );
    create table public.loads(
      id uuid primary key,
      tenant_id uuid not null,
      load_number text not null,
      external_load_number text,
      load_date date,
      arrival_date date,
      gross_cargo_value numeric(14,2) not null default 0,
      freight_amount numeric(14,2) not null default 0,
      freight_percent numeric(8,4),
      total_weight_kg numeric,
      invoice_count integer not null default 0,
      cte_count integer not null default 0,
      operational_status text,
      billing_status text,
      payment_status text not null default 'unpaid',
      expected_payment_date date,
      payment_date date,
      received_amount numeric(14,2) not null default 0,
      legacy_status_text text,
      receivable_id uuid,
      client_invoice_id uuid,
      doccob_export_id uuid,
      origin text,
      destination text,
      status text not null default 'planned',
      created_at timestamptz not null,
      driver_id uuid,
      vehicle_id uuid,
      trailer_plate text,
      last_import_batch_id uuid
    );

    create function public.is_tenant_operator_or_admin(_tenant_id uuid)
    returns boolean language sql stable security definer set search_path = ''
    as 'select exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role in (''owner'',''admin'',''operator''))';

    alter table public.loads enable row level security;
    alter table public.drivers enable row level security;
    alter table public.vehicles enable row level security;
    create policy loads_internal_read on public.loads for select to authenticated
      using (public.is_tenant_operator_or_admin(tenant_id));
    create policy drivers_internal_read on public.drivers for select to authenticated
      using (public.is_tenant_operator_or_admin(tenant_id));
    create policy vehicles_internal_read on public.vehicles for select to authenticated
      using (public.is_tenant_operator_or_admin(tenant_id));
    grant select on public.loads, public.drivers, public.vehicles to authenticated;
  `);
  await db.exec(loadControlPaginationSql());
  return { db };
}

export async function seedLoadControlPagination(db: PGlite, count = 625) {
  const i = loadControlIds;
  await db.query(
    'insert into public.tenant_memberships(tenant_id,user_id,role,active) values($1,$2,\'operator\',true)',
    [i.tenant, i.operator],
  );
  await db.query(`
    insert into public.loads(
      id,tenant_id,load_number,external_load_number,load_date,arrival_date,
      gross_cargo_value,freight_amount,total_weight_kg,invoice_count,cte_count,
      operational_status,billing_status,payment_status,expected_payment_date,
      received_amount,origin,destination,status,created_at
    )
    select
      ('70000000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
      $1::uuid,
      'LC-' || lpad(series::text,4,'0'),
      'EXT-' || lpad(series::text,4,'0'),
      date '2026-01-01' + ((series - 1) % 240),
      null,
      1000 + series,
      100 + series,
      10 + series,
      series % 5,
      series % 3,
      case when series % 2 = 0 then 'delivered' else 'in_transit' end,
      case when series % 2 = 0 then 'invoiced' else 'not_invoiced' end,
      case series % 4 when 0 then 'paid' when 1 then 'unpaid' when 2 then 'partially_paid' else 'overdue' end,
      date '2026-10-01',
      case when series % 4 = 0 then 100 + series else 0 end,
      'Origem ' || series,
      'Destino ' || series,
      'planned',
      timestamptz '2026-01-01 00:00:00+00' + series * interval '1 minute'
    from generate_series(1,$2::integer) series
  `, [i.tenant, count]);
  await db.query(`
    insert into public.loads(
      id,tenant_id,load_number,gross_cargo_value,freight_amount,payment_status,
      received_amount,status,created_at
    ) values(
      '79999999-0000-4000-8000-000000000001',$1,'OTHER-001',999,99,'unpaid',0,'planned',
      timestamptz '2026-01-02 00:00:00+00'
    )
  `, [i.otherTenant]);
}

export async function setLoadControlActor(db: PGlite, actor = loadControlIds.operator) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec('set local role authenticated');
}

export async function listLoadControlPage(
  db: PGlite,
  filters: Record<string, unknown> = {},
  limit = 250,
  cursor: Record<string, unknown> | null = null,
  tenant = loadControlIds.tenant,
) {
  const result = await db.query<{ result: LoadControlDatabasePage }>(
    'select public.list_load_control_page_v2($1,$2::jsonb,$3,$4::jsonb) result',
    [tenant, JSON.stringify(filters), limit, cursor === null ? null : JSON.stringify(cursor)],
  );
  return result.rows[0].result;
}
