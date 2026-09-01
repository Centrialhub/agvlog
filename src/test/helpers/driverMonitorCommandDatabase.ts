import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { operationRpc } from './operationOutcomeDatabase.ts';

export const driverMonitorMigration = '20260901145247_make_driver_monitor_commands_recoverable.sql';
export const driverMonitorSql = () =>
  readFileSync('supabase/migrations/' + driverMonitorMigration, 'utf8');

export const driverMonitorIds = {
  tenant: 'da100000-0000-4000-8000-000000000001',
  otherTenant: 'da100000-0000-4000-8000-000000000002',
  operator: 'da100000-0000-4000-8000-000000000003',
  viewer: 'da100000-0000-4000-8000-000000000004',
  driver: 'da100000-0000-4000-8000-000000000005',
  otherDriver: 'da100000-0000-4000-8000-000000000006',
  vehicle: 'da100000-0000-4000-8000-000000000007',
  otherVehicle: 'da100000-0000-4000-8000-000000000008',
  load: 'da100000-0000-4000-8000-000000000009',
  otherLoad: 'da100000-0000-4000-8000-000000000010',
  request: 'da100000-0000-4000-8000-000000000011',
};

const fixtureSql = `
  create role anon;
  create role authenticated;
  create role service_role;
  create schema auth;
  create schema private;

  create function auth.uid() returns uuid language sql stable set search_path=''
  as $$ select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid $$;

  create table public.tenants(id uuid primary key);
  create table public.tenant_memberships(
    tenant_id uuid not null references public.tenants(id),
    user_id uuid not null,
    role text not null,
    active boolean not null default true,
    primary key(tenant_id,user_id)
  );
  create function public.is_tenant_operator_or_admin(_tenant uuid)
  returns boolean language sql stable security definer set search_path=''
  as $$ select exists(
    select 1 from public.tenant_memberships
     where tenant_id=_tenant and user_id=auth.uid() and active
       and role in ('owner','admin','operator')
  ) $$;

  create table public.drivers(
    id uuid primary key,
    tenant_id uuid not null references public.tenants(id),
    name text not null,
    unique(tenant_id,id)
  );
  create table public.vehicles(
    id uuid primary key,
    tenant_id uuid not null references public.tenants(id),
    plate text not null,
    unique(tenant_id,id)
  );
  create table public.loads(
    id uuid primary key,
    tenant_id uuid not null references public.tenants(id),
    unique(tenant_id,id)
  );

  create table public.driver_route_monitors(
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    driver_id uuid,
    vehicle_id uuid,
    load_id uuid,
    route_id uuid,
    monitor_number text not null,
    driver_name_snapshot text,
    vehicle_plate_snapshot text,
    planned_route_text text,
    planned_cities jsonb not null default '[]',
    started_at timestamptz,
    expected_return_date date,
    return_deadline_days integer,
    actual_returned_at timestamptz,
    total_deliveries integer not null default 0,
    completed_deliveries integer not null default 0,
    remaining_deliveries integer not null default 0,
    current_city text,
    current_state text,
    next_city text,
    next_state text,
    remaining_cities jsonb not null default '[]',
    arrival_forecast_text text,
    arrival_forecast_at timestamptz,
    status text not null default 'active',
    last_update_at timestamptz,
    notes text,
    source_type text not null default 'manual',
    import_batch_id uuid,
    created_at timestamptz not null default clock_timestamp(),
    updated_at timestamptz not null default clock_timestamp(),
    created_by uuid,
    updated_by uuid,
    unique(tenant_id,id),
    foreign key(tenant_id,driver_id) references public.drivers(tenant_id,id),
    foreign key(tenant_id,vehicle_id) references public.vehicles(tenant_id,id),
    foreign key(tenant_id,load_id) references public.loads(tenant_id,id)
  );

  create table public.driver_monitoring_history(
    id uuid primary key default gen_random_uuid(),
    tenant_id uuid not null references public.tenants(id),
    monitor_id uuid not null,
    action text not null,
    field_name text,
    old_value text,
    new_value text,
    reason text,
    metadata jsonb not null default '{}',
    created_at timestamptz not null default clock_timestamp(),
    created_by uuid,
    foreign key(tenant_id,monitor_id)
      references public.driver_route_monitors(tenant_id,id) on delete cascade
  );
  alter table public.driver_monitoring_history enable row level security;
  create policy dmh_insert on public.driver_monitoring_history
    for insert to authenticated with check (true);
  create policy dmh_select on public.driver_monitoring_history
    for select to authenticated using (true);
  grant usage on schema public, auth to authenticated;
  grant select, insert on public.driver_monitoring_history to authenticated;
`;

export async function createDriverMonitorDatabase(candidate = true) {
  const db = new PGlite();
  await db.exec(fixtureSql);
  const ids = driverMonitorIds;
  await db.query('insert into public.tenants(id) values($1),($2)', [ids.tenant, ids.otherTenant]);
  await db.query(
    `insert into public.tenant_memberships(tenant_id,user_id,role,active)
     values($1,$2,'operator',true),($1,$3,'driver',true)`,
    [ids.tenant, ids.operator, ids.viewer],
  );
  await db.query(
    'insert into public.drivers(id,tenant_id,name) values($1,$2,$3),($4,$5,$6)',
    [ids.driver, ids.tenant, 'Motorista QA', ids.otherDriver, ids.otherTenant, 'Motorista Externo'],
  );
  await db.query(
    'insert into public.vehicles(id,tenant_id,plate) values($1,$2,$3),($4,$5,$6)',
    [ids.vehicle, ids.tenant, 'ABC1D23', ids.otherVehicle, ids.otherTenant, 'XYZ9Z99'],
  );
  await db.query(
    'insert into public.loads(id,tenant_id) values($1,$2),($3,$4)',
    [ids.load, ids.tenant, ids.otherLoad, ids.otherTenant],
  );
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [ids.operator]);
  if (candidate) await db.exec(driverMonitorSql());
  return db;
}

let sequence = 20;
export function driverMonitorCreatePayload(options: Record<string, unknown> = {}) {
  const suffix = String(sequence++).padStart(12, '0');
  return {
    version: 1,
    tenant_id: driverMonitorIds.tenant,
    actor_id: driverMonitorIds.operator,
    request_id: 'da100000-0000-4000-8000-' + suffix,
    action: 'create',
    monitor_id: null,
    expected_revision: null,
    reason: 'Cadastro QA',
    changes: {
      driver_name_snapshot: 'Motorista QA',
      vehicle_plate_snapshot: 'ABC1D23',
      planned_route_text: 'Montes Claros / Janaúba',
      planned_cities: ['Montes Claros', 'Janaúba'],
      started_at: '2026-09-01T12:00:00.000Z',
      expected_return_date: '2026-09-03',
      return_deadline_days: 2,
      total_deliveries: 10,
      notes: 'Monitoramento QA',
    },
    ...options,
  };
}

export function driverMonitorUpdatePayload(
  monitorId: string,
  expectedRevision: number,
  options: Record<string, unknown> = {},
) {
  const suffix = String(sequence++).padStart(12, '0');
  return {
    version: 1,
    tenant_id: driverMonitorIds.tenant,
    actor_id: driverMonitorIds.operator,
    request_id: 'da100000-0000-4000-8000-' + suffix,
    action: 'update',
    monitor_id: monitorId,
    expected_revision: expectedRevision,
    reason: 'Edição QA',
    changes: { notes: 'Editado QA' },
    ...options,
  };
}

export async function applyDriverMonitorCommand(db: PGlite, payload: unknown) {
  return (await operationRpc<{ result: Record<string, unknown> }>(
    db,
    'select public.apply_driver_monitor_command($1::jsonb) result',
    [JSON.stringify(payload)],
  )).rows[0].result;
}
