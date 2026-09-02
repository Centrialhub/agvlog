import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';

export const loadAggregateMigration = '20260901201500_make_load_aggregate_commands_atomic.sql';
export const atomicLoadNumberMigration = '20260902013811_enforce_atomic_load_number_allocation.sql';
export const atomicLoadForeignKeyIndexMigration = '20260902022100_index_atomic_load_foreign_keys.sql';
export const loadAggregateSql = () => readFileSync(`supabase/migrations/${loadAggregateMigration}`, 'utf8');
export const atomicLoadNumberSql = () => readFileSync(`supabase/migrations/${atomicLoadNumberMigration}`, 'utf8');
export const atomicLoadForeignKeyIndexSql = () => readFileSync(
  `supabase/migrations/${atomicLoadForeignKeyIndexMigration}`,
  'utf8',
);
export const loadAggregateIds = {
  tenant: '20000000-0000-4000-8000-000000000001',
  otherTenant: '20000000-0000-4000-8000-000000000002',
  operator: '10000000-0000-4000-8000-000000000001',
  driver: '60000000-0000-4000-8000-000000000001',
  otherDriver: '60000000-0000-4000-8000-000000000002',
  vehicle: '50000000-0000-4000-8000-000000000001',
  otherVehicle: '50000000-0000-4000-8000-000000000002',
  load: '70000000-0000-4000-8000-000000000001',
  load2: '70000000-0000-4000-8000-000000000002',
  trip: '80000000-0000-4000-8000-000000000001',
};

const schema = `
  create role anon; create role authenticated; create role service_role;
  create schema extensions;
  create function extensions.digest(bytea,text) returns bytea language sql immutable as
    $$select decode(md5($1),'hex')$$;
  create schema auth;
  create function auth.uid() returns uuid language sql stable as
    $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
  create function public.get_next_load_number_v1(uuid) returns text language sql security definer as
    $$select '1001'::text$$;
  grant execute on function public.get_next_load_number_v1(uuid) to authenticated,service_role;
  create table auth.users(id uuid primary key);
  create table public.tenants(id uuid primary key);
  create type public.app_role as enum('owner','admin','operator','driver','client');
  create table public.tenant_memberships(id uuid primary key default gen_random_uuid(),tenant_id uuid,user_id uuid,
    role public.app_role,active boolean,created_at timestamptz default now(),updated_at timestamptz default now());
  create table public.drivers(id uuid primary key,tenant_id uuid not null,user_id uuid,active boolean not null default true,
    current_vehicle_id uuid);
  create table public.vehicles(id uuid primary key,tenant_id uuid not null,active boolean not null default true,
    blocked boolean default false,in_maintenance boolean default false,current_driver_id uuid,plate text);
  create table public.dispatch_trips(id uuid primary key,tenant_id uuid not null,load_id uuid,status text,
    actual_start_at timestamptz,actual_end_at timestamptz,driver_id uuid,vehicle_id uuid,updated_at timestamptz default now());
  create table public.loads(
    id uuid primary key default gen_random_uuid(),tenant_id uuid not null references public.tenants(id),
    load_number text not null,vehicle_id uuid,driver_id uuid,origin text,destination text,
    total_pallet_count integer default 0,total_weight_kg numeric default 0,total_volume_m3 numeric default 0,
    status text not null default 'planned',trip_id uuid,notes text,created_at timestamptz default now(),
    updated_at timestamptz default now(),created_by uuid,operation_type text,supplier_manifest text,
    distribution_manifest text,shipment_manifest text,origin_manifest text,os_number text,
    scheduled_load_at timestamptz,actual_load_at timestamptz,trailer_plate text,merchandise_value numeric,ciot text,
    monitored boolean default false,dedicated_vehicle boolean default false,gate_departure_at timestamptz,
    arrival_at timestamptz,estimated_arrival_at timestamptz,monitor_responsible text,driver_type text,
    sm_manager text,sm_release text,payment_method text,schedule_at timestamptz,occurrence_at timestamptz,
    occurrence_responsible text,occurrence_notes text,cash_to_receive numeric,pix_to_receive numeric,
    external_load_number text,control_load_number text,load_date date,arrival_date date,closed_at timestamptz,
    expected_payment_date date,payment_date date,operational_status text,billing_status text,payment_status text,
    gross_cargo_value numeric,freight_amount numeric,received_amount numeric,freight_percent numeric,
    invoice_count integer,cte_count integer,legacy_status_text text,source_origin text,last_import_batch_id uuid,
    receivable_id uuid,client_invoice_id uuid,doccob_export_id uuid,closing_report_id uuid,closing_status text,
    closing_report_number text,on_hold boolean default false,hold_reason text,held_at timestamptz,held_by uuid,
    version integer not null default 1,
    constraint loads_driver_id_fkey foreign key(driver_id) references public.drivers(id),
    constraint loads_vehicle_id_fkey foreign key(vehicle_id) references public.vehicles(id),
    constraint loads_trip_id_fkey foreign key(trip_id) references public.dispatch_trips(id),
    unique(tenant_id,load_number)
  );
  create function public.loads_autofill_driver_from_vehicle() returns trigger language plpgsql as $$begin
    if new.driver_id is null and new.vehicle_id is not null then
      select current_driver_id into new.driver_id from public.vehicles
       where id=new.vehicle_id and tenant_id=new.tenant_id;
    end if;
    return new;
  end$$;
  create trigger trg_loads_autofill_driver before insert or update of vehicle_id,driver_id on public.loads
    for each row execute function public.loads_autofill_driver_from_vehicle();
  create table public.dispatch_trip_loads(id uuid primary key default gen_random_uuid(),tenant_id uuid not null,
    dispatch_trip_id uuid not null references public.dispatch_trips(id),load_id uuid not null references public.loads(id),
    unique(dispatch_trip_id,load_id));
  create table public.load_items(id uuid primary key default gen_random_uuid(),tenant_id uuid,load_id uuid references public.loads(id),
    weight_kg numeric,pallet_count integer,volume_m3 numeric);
  create table public.fiscal_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,load_id uuid references public.loads(id));
  create table public.load_payments(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id));
  create table public.driver_settlement_loads(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id));
  create table public.closing_report_items(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id));
  create table public.load_unloading_charges(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id));
  create table public.payables(id uuid primary key default gen_random_uuid(),load_id uuid references public.loads(id));
  create table public.load_status_history(id uuid primary key default gen_random_uuid(),tenant_id uuid,load_id uuid,
    field_name text,old_value text,new_value text,reason text,created_at timestamptz default now(),created_by uuid);
  create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,entity_type text,
    entity_id uuid,action text,old_value jsonb,new_value jsonb,source text);
  create function public._log_entity_audit(uuid,text,uuid,text,jsonb,jsonb,text) returns void language sql as $$
    insert into public.entity_audit_log(tenant_id,entity_type,entity_id,action,old_value,new_value,source)
    values($1,$2,$3,$4,$5,$6,$7)$$;
  create function public._load_is_locked(uuid) returns boolean language sql stable security definer set search_path='' as $$
    select exists(select 1 from public.loads l where l.id=$1 and (l.status in('in_transit','delivered','cancelled')
      or exists(select 1 from public.dispatch_trips t where (t.load_id=l.id or exists(
        select 1 from public.dispatch_trip_loads x where x.dispatch_trip_id=t.id and x.load_id=l.id))
        and (t.actual_start_at is not null or t.status in('in_transit','in_progress','completed')))))$$;
`;

export async function createLoadAggregateDatabase() {
  const db = new PGlite();
  await db.exec(schema);
  await db.exec(loadAggregateSql());
  await db.exec(atomicLoadNumberSql());
  await db.exec(atomicLoadForeignKeyIndexSql());
  const i = loadAggregateIds;
  await db.query('insert into public.tenants values($1),($2)', [i.tenant, i.otherTenant]);
  await db.query('insert into auth.users values($1)', [i.operator]);
  await db.query("insert into public.tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'operator',true)", [i.tenant, i.operator]);
  await db.query('insert into public.drivers(id,tenant_id,active) values($1,$2,true),($3,$4,true)', [i.driver, i.tenant, i.otherDriver, i.otherTenant]);
  await db.query('insert into public.vehicles(id,tenant_id,active) values($1,$2,true),($3,$4,true)', [i.vehicle, i.tenant, i.otherVehicle, i.otherTenant]);
  return db;
}

export async function seedLoad(db: PGlite, id = loadAggregateIds.load, number = '1001') {
  await db.query(`insert into public.loads(id,tenant_id,load_number,status,version,on_hold,origin,destination)
    values($1,$2,$3,'planned',1,false,'Origem QA','Destino QA')`, [id, loadAggregateIds.tenant, number]);
}

export const loadCommand = (action: string, fields: Record<string, unknown> = {}) => ({
  schema_version: 1, tenant_id: loadAggregateIds.tenant, request_id: randomUUID(), action, ...fields,
});

export async function applyLoadCommand(db: PGlite, payload: unknown) {
  await db.exec('set role authenticated');
  const result = (await db.query<{ result: Record<string, unknown> }>(
    'select public.apply_load_aggregate_command($1::jsonb) result', [JSON.stringify(payload)],
  )).rows[0].result;
  // On an error the caller rolls back its savepoint/transaction; attempting
  // RESET ROLE there would mask the original PostgreSQL diagnostic.
  await db.exec('reset role');
  return result;
}
