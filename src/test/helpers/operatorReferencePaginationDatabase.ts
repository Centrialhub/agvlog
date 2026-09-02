import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const operatorReferencePaginationMigration = '20260901211644_add_operator_cursor_readers.sql';
export const operatorReferencePaginationSql = () => readFileSync(
  `supabase/migrations/${operatorReferencePaginationMigration}`,
  'utf8',
);

export const operatorReferenceIds = {
  tenant: '31000000-0000-4000-8000-000000000001',
  otherTenant: '31000000-0000-4000-8000-000000000002',
  operator: '31000000-0000-4000-8000-000000000003',
  outsider: '31000000-0000-4000-8000-000000000004',
};

const legacyReaders = `
  create function public.list_loads_v1(uuid,text,text[],timestamptz,integer) returns jsonb language sql as 'select ''{}''::jsonb';
  create function public.list_clients_v1(uuid,text,text,integer) returns jsonb language sql as 'select ''{}''::jsonb';
  create function public.list_drivers_v1(uuid,text,text,integer) returns jsonb language sql as 'select ''{}''::jsonb';
  create function public.list_operational_routes_v1(uuid,text,text,integer) returns jsonb language sql as 'select ''{}''::jsonb';
  create function public.list_fiscal_documents_v1(uuid,text,text[],timestamptz,integer) returns jsonb language sql as 'select ''{}''::jsonb';
  create function public.get_next_load_number_v1(uuid) returns text language sql as 'select ''1''';
  grant execute on function public.list_loads_v1(uuid,text,text[],timestamptz,integer) to authenticated,service_role;
  grant execute on function public.list_clients_v1(uuid,text,text,integer) to authenticated,service_role;
  grant execute on function public.list_drivers_v1(uuid,text,text,integer) to authenticated,service_role;
  grant execute on function public.list_operational_routes_v1(uuid,text,text,integer) to authenticated,service_role;
  grant execute on function public.list_fiscal_documents_v1(uuid,text,text[],timestamptz,integer) to authenticated,service_role;
  grant execute on function public.get_next_load_number_v1(uuid) to authenticated,service_role;
`;

export async function createOperatorReferencePaginationDatabase({ legacy = true }: { legacy?: boolean } = {}) {
  const db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'', true), '''')::uuid';
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
      name text not null,
      active boolean not null default true,
      user_id uuid,
      current_vehicle_id uuid,
      doc text,
      phone text,
      cpf text,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table public.vehicles(
      id uuid primary key,
      tenant_id uuid not null,
      plate text not null,
      nickname text,
      type text,
      active boolean not null default true,
      tags jsonb,
      created_by uuid,
      updated_by uuid,
      tank_capacity_liters double precision,
      speed_limit_kmh integer,
      fuel_canonical_key text,
      max_pallets integer,
      max_weight_kg numeric,
      max_volume_m3 numeric,
      body_type text,
      base_consumption_estimate numeric,
      loaded_consumption_factor numeric,
      expected_speed_penalty_loaded numeric,
      current_driver_id uuid,
      blocked boolean,
      in_maintenance boolean,
      odometer_km numeric,
      model text,
      year_of_manufacture integer,
      brand text,
      capacity_ton numeric,
      chassis text,
      color text,
      renavam text,
      result_center text,
      result_area text,
      business_unit text,
      vehicle_type_code text,
      body_type_code text,
      category text,
      fleet_type_code text,
      axle_structure text,
      situation_code text,
      avg_km_per_liter numeric,
      city text,
      uf text,
      owner_name text,
      owner_neighborhood text,
      owner_mobile text,
      owner_phone text,
      owner_notes text,
      tracker_name text,
      tracker_login text,
      tracker_password text,
      plate_raw text,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table public.loads(
      id uuid primary key,
      tenant_id uuid not null,
      load_number text not null,
      vehicle_id uuid,
      driver_id uuid,
      status text not null default 'planned',
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table public.clients(
      id uuid primary key,
      tenant_id uuid not null,
      company_name text not null,
      legal_name text,
      trade_name text,
      tax_id text,
      internal_code text,
      sigla text,
      payer_group text,
      address_city text,
      is_client boolean,
      is_supplier boolean,
      active boolean not null default true,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );
    create table public.operational_routes(
      id uuid primary key,
      tenant_id uuid not null,
      name text not null,
      active boolean,
      created_at timestamptz not null,
      updated_at timestamptz not null
    );

    create function public.is_tenant_operator_or_admin(_tenant_id uuid)
    returns boolean language sql stable security definer set search_path = '' as
      'select exists(select 1 from public.tenant_memberships where tenant_id=_tenant_id and user_id=auth.uid() and active and role in (''owner'',''admin'',''operator''))';

    alter table public.loads enable row level security;
    alter table public.clients enable row level security;
    alter table public.drivers enable row level security;
    alter table public.vehicles enable row level security;
    alter table public.operational_routes enable row level security;
    create policy loads_operator_read on public.loads for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
    create policy clients_operator_read on public.clients for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
    create policy drivers_operator_read on public.drivers for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
    create policy vehicles_operator_read on public.vehicles for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
    create policy routes_operator_read on public.operational_routes for select to authenticated using (public.is_tenant_operator_or_admin(tenant_id));
    grant select on public.loads,public.clients,public.drivers,public.operational_routes to authenticated;
    grant select(
      id,tenant_id,plate,nickname,type,active,tags,created_at,updated_at,created_by,updated_by,
      tank_capacity_liters,speed_limit_kmh,fuel_canonical_key,max_pallets,max_weight_kg,max_volume_m3,
      body_type,base_consumption_estimate,loaded_consumption_factor,expected_speed_penalty_loaded,
      current_driver_id,blocked,in_maintenance,odometer_km,model,year_of_manufacture,brand,capacity_ton,
      chassis,color,renavam,result_center,result_area,business_unit,vehicle_type_code,body_type_code,
      category,fleet_type_code,axle_structure,situation_code,avg_km_per_liter,city,uf,owner_name,
      owner_neighborhood,owner_mobile,owner_phone,owner_notes,tracker_name,tracker_login,plate_raw
    ) on public.vehicles to authenticated;
    ${legacy ? legacyReaders : ''}
  `);
  await db.exec(operatorReferencePaginationSql());
  return db;
}

export async function seedOperatorReferencePagination(db: PGlite, loadCount = 501) {
  const ids = operatorReferenceIds;
  await db.query(
    `insert into public.tenant_memberships(tenant_id,user_id,role,active)
     values($1,$2,'operator',true)`,
    [ids.tenant, ids.operator],
  );
  await db.query(`
    insert into public.loads(id,tenant_id,load_number,status,created_at,updated_at)
    select
      ('32000000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
      $1::uuid,
      'LOAD-' || lpad(series::text,4,'0'),
      'planned',
      timestamptz '2026-01-01 00:00:00+00' + floor(series / 2.0) * interval '1 minute',
      timestamptz '2026-01-01 00:00:00+00'
    from generate_series(1,$2::integer) series
  `, [ids.tenant, loadCount]);
  await db.query(`
    insert into public.loads(id,tenant_id,load_number,status,created_at,updated_at)
    values('32999999-0000-4000-8000-000000000001',$1,'OTHER','planned',now(),now())
  `, [ids.otherTenant]);
  await db.query(`insert into public.clients(id,tenant_id,company_name,active,created_at,updated_at) values
    ('33000000-0000-4000-8000-000000000001',$1,'Cliente ativo',true,'2026-01-01','2026-01-01'),
    ('33000000-0000-4000-8000-000000000002',$1,'Cliente inativo',false,'2026-01-02','2026-01-02')`, [ids.tenant]);
  await db.query(`insert into public.drivers(id,tenant_id,name,active,current_vehicle_id,created_at,updated_at) values
    ('34000000-0000-4000-8000-000000000001',$1,'Motorista ativo',true,'35000000-0000-4000-8000-000000000001','2026-01-01','2026-01-01'),
    ('34000000-0000-4000-8000-000000000002',$1,'Motorista inativo',false,null,'2026-01-02','2026-01-02')`, [ids.tenant]);
  await db.query(`insert into public.vehicles(id,tenant_id,plate,nickname,active,current_driver_id,tracker_password,created_at,updated_at) values
    ('35000000-0000-4000-8000-000000000001',$1,'AAA1A11','Seguro',true,'34000000-0000-4000-8000-000000000001','nao-expor','2026-01-01','2026-01-01'),
    ('35000000-0000-4000-8000-000000000002',$1,'BBB2B22','Inativo',false,null,'nao-expor','2026-01-02','2026-01-02')`, [ids.tenant]);
  await db.query(`insert into public.operational_routes(id,tenant_id,name,active,created_at,updated_at) values
    ('36000000-0000-4000-8000-000000000001',$1,'Rota ativa',true,'2026-01-01','2026-01-01'),
    ('36000000-0000-4000-8000-000000000002',$1,'Rota inativa',false,'2026-01-02','2026-01-02')`, [ids.tenant]);
}

export async function setOperatorReferenceActor(db: PGlite, actor = operatorReferenceIds.operator) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec('set local role authenticated');
}

export async function listOperatorReferencePage(
  db: PGlite,
  resource: string,
  includeInactive = false,
  limit = 500,
  cursor: unknown = null,
  tenant = operatorReferenceIds.tenant,
) {
  const result = await db.query<{ result: {
    version: number;
    tenant_id: string;
    actor_id: string;
    resource: string;
    items: Array<Record<string, unknown>>;
    next_cursor: Record<string, unknown> | null;
  } }>(
    'select public.list_operator_reference_page_v1($1,$2,$3,$4,$5::jsonb) result',
    [tenant, resource, includeInactive, limit, cursor === null ? null : JSON.stringify(cursor)],
  );
  return result.rows[0].result;
}

export async function listOperatorClientsPage(
  db: PGlite,
  options: {
    search?: string;
    kind?: string;
    limit?: number;
    cursor?: unknown;
    direction?: string;
    snapshotAt?: string | null;
    tenant?: string;
  } = {},
) {
  const result = await db.query<{ result: {
    version: number;
    tenant_id: string;
    actor_id: string;
    resource: string;
    snapshot_at: string;
    items: Array<Record<string, unknown>>;
    total_count: number;
    previous_cursor: Record<string, unknown> | null;
    next_cursor: Record<string, unknown> | null;
  } }>(
    'select public.list_operator_clients_page_v1($1,$2,$3,$4,$5::jsonb,$6,$7) result',
    [
      options.tenant ?? operatorReferenceIds.tenant,
      options.search ?? '',
      options.kind ?? 'all',
      options.limit ?? 50,
      options.cursor === undefined || options.cursor === null ? null : JSON.stringify(options.cursor),
      options.direction ?? 'next',
      options.snapshotAt ?? null,
    ],
  );
  return result.rows[0].result;
}
