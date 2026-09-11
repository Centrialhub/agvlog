// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260910203617_ssx_mapping_conflict_review.sql', 'utf8');
const activeTenantMigration = readFileSync(
  'supabase/migrations/20260910223000_harden_ssx_mapping_conflict_active_tenant.sql',
  'utf8',
);
const indexMigration = readFileSync(
  'supabase/migrations/20260910223935_index_ssx_mapping_conflict_foreign_keys.sql',
  'utf8',
);
const id = {
  tenant: '10000000-0000-4000-8000-000000000001',
  otherTenant: '10000000-0000-4000-8000-000000000002',
  user: '20000000-0000-4000-8000-000000000001',
  outsider: '20000000-0000-4000-8000-000000000002',
  account: '30000000-0000-4000-8000-000000000001',
  unit: '40000000-0000-4000-8000-000000000001',
  unitTwo: '40000000-0000-4000-8000-000000000002',
  vehicleA: '50000000-0000-4000-8000-000000000001',
  vehicleB: '50000000-0000-4000-8000-000000000002',
};

let db: PGlite;

async function asRole(
  role: 'service_role' | 'authenticated',
  user: string | null,
  sql: string,
  params: unknown[] = [],
  activeTenant = user === id.outsider ? id.otherTenant : id.tenant,
) {
  await db.exec(`set role ${role}`);
  try {
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user || '']);
    await db.query("select set_config('test.active_tenant',$1,false)", [user ? activeTenant : '']);
    return (await db.query(sql, params)).rows;
  } finally {
    await db.exec('reset role');
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role bypassrls;
    create schema auth; create schema private;
    grant usage on schema auth,private to authenticated,service_role;
    create table auth.users(id uuid primary key);
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create function auth.role() returns text language sql stable as $$select current_user::text$$;
    create function private.request_tenant_id() returns uuid language sql stable as
      $$select nullif(current_setting('test.active_tenant',true),'')::uuid$$;
    grant execute on function private.request_tenant_id() to authenticated,service_role;
    create table public.tenants(id uuid primary key);
    create table public.tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
    create function public.is_tenant_operator_or_admin(_tenant uuid) returns boolean
      language sql stable security definer set search_path='' as $$
        select exists(select 1 from public.tenant_memberships
          where tenant_id=_tenant and user_id=auth.uid() and active and role in('owner','admin','operator'))
      $$;
    create table public.integration_accounts(id uuid primary key,tenant_id uuid references public.tenants(id));
    create table public.provider_units(id uuid primary key,tenant_id uuid references public.tenants(id),
      integration_account_id uuid references public.integration_accounts(id),external_code text);
    create table public.vehicles(id uuid primary key,tenant_id uuid references public.tenants(id),plate text,nickname text,active boolean default true);
    create table public.vehicle_tracker_links(id uuid primary key default gen_random_uuid(),tenant_id uuid references public.tenants(id),
      vehicle_id uuid references public.vehicles(id),provider_unit_id uuid references public.provider_units(id),active boolean default true,
      start_at timestamptz default now(),end_at timestamptz,created_at timestamptz default now());
    create unique index uq_ssx_active_link_per_unit on public.vehicle_tracker_links(tenant_id,provider_unit_id) where active;
    create unique index uq_ssx_active_link_per_vehicle on public.vehicle_tracker_links(tenant_id,vehicle_id) where active;
    grant select on public.provider_units,public.vehicles to service_role;
    grant select,insert,update on public.vehicle_tracker_links to service_role;
    insert into auth.users values('${id.user}'),('${id.outsider}');
    insert into public.tenants values('${id.tenant}'),('${id.otherTenant}');
    insert into public.tenant_memberships values('${id.tenant}','${id.user}','operator',true),
      ('${id.otherTenant}','${id.outsider}','operator',true);
    insert into public.integration_accounts values('${id.account}','${id.tenant}');
    insert into public.provider_units values('${id.unit}','${id.tenant}','${id.account}','UNIT-1'),
      ('${id.unitTwo}','${id.tenant}','${id.account}','UNIT-2');
    insert into public.vehicles values('${id.vehicleA}','${id.tenant}','AAA1A11','Cavalo A',true),
      ('${id.vehicleB}','${id.tenant}','AAA1A11','Cavalo B',true);
  `);
  await db.exec(migration);
  await db.exec(activeTenantMigration);
  await db.exec(indexMigration);
}, 30_000);

afterAll(async () => db?.close());

describe('durable SSX mapping conflict review', () => {
  it('deduplicates observations, enforces browser ACL and resolves one audited link', async () => {
    const payload = JSON.stringify({
      tenant_id: id.tenant,
      integration_account_id: id.account,
      provider_unit_id: id.unit,
      external_code: 'UNIT-1',
      observed_plate: 'AAA-1A11',
      normalized_plate: 'AAA1A11',
      conflict_type: 'ambiguous_plate_match',
      candidate_vehicle_ids: [id.vehicleA, id.vehicleB],
    });
    const first = await asRole('service_role', null,
      'select public.report_ssx_mapping_conflict_v1($1::jsonb) id', [payload]);
    const replay = await asRole('service_role', null,
      'select public.report_ssx_mapping_conflict_v1($1::jsonb) id', [payload]);
    expect(replay).toEqual(first);
    expect((await db.query('select occurrence_count from public.ssx_mapping_conflicts')).rows)
      .toEqual([{ occurrence_count: 2 }]);

    await expect(asRole('authenticated', id.user, 'select * from public.ssx_mapping_conflicts'))
      .rejects.toMatchObject({ code: '42501' });
    const open = await asRole('authenticated', id.user,
      "select public.list_ssx_mapping_conflicts_v1($1,'open',100,0) result", [id.tenant]);
    expect((open[0] as { result: Array<{ candidate_vehicles: unknown[] }> }).result[0].candidate_vehicles).toHaveLength(2);

    await asRole('authenticated', id.user,
      'select public.resolve_ssx_mapping_conflict_v1($1,$2,$3)',
      [(first[0] as { id: string }).id, id.vehicleA, 'Placa conferida no documento do veículo']);
    expect((await db.query('select status,resolved_by,resolved_vehicle_id,resolution_reason from public.ssx_mapping_conflicts')).rows)
      .toEqual([{ status: 'resolved', resolved_by: id.user, resolved_vehicle_id: id.vehicleA,
        resolution_reason: 'Placa conferida no documento do veículo' }]);
    expect((await db.query('select vehicle_id,provider_unit_id,active from public.vehicle_tracker_links')).rows)
      .toEqual([{ vehicle_id: id.vehicleA, provider_unit_id: id.unit, active: true }]);
  });

  it('blocks cross-tenant review and a second active unit for the chosen vehicle', async () => {
    await expect(asRole('authenticated', id.outsider,
      "select public.list_ssx_mapping_conflicts_v1($1,'all',100,0)", [id.tenant]))
      .rejects.toMatchObject({ code: '42501' });

    const payload = JSON.stringify({ tenant_id: id.tenant, integration_account_id: id.account,
      provider_unit_id: id.unitTwo, external_code: 'UNIT-2', observed_plate: 'AAA1A11', normalized_plate: 'AAA1A11',
      conflict_type: 'mapping_conflict', candidate_vehicle_ids: [id.vehicleA], linked_vehicle_id: id.vehicleA });
    const conflict = await asRole('service_role', null,
      'select public.report_ssx_mapping_conflict_v1($1::jsonb) id', [payload]);
    await expect(asRole('authenticated', id.user,
      'select public.resolve_ssx_mapping_conflict_v1($1,$2,$3)',
      [(conflict[0] as { id: string }).id, id.vehicleA, 'Revisão manual do vínculo']))
      .rejects.toThrow('vehicle_already_linked_to_another_unit');
  });

  it('blocks a multi-tenant operator when the requested conflict tenant is not active', async () => {
    await db.exec(`
      insert into public.tenant_memberships
      values ('${id.otherTenant}','${id.user}','operator',true)
    `);
    const conflict = (await db.query<{ id: string }>(
      "select id from public.ssx_mapping_conflicts where tenant_id=$1 and status='open' limit 1",
      [id.tenant],
    )).rows[0];
    expect(conflict?.id).toBeTruthy();

    await expect(asRole(
      'authenticated',
      id.user,
      "select public.list_ssx_mapping_conflicts_v1($1,'all',100,0)",
      [id.tenant],
      id.otherTenant,
    )).rejects.toMatchObject({ code: '42501' });
    await expect(asRole(
      'authenticated',
      id.user,
      'select public.resolve_ssx_mapping_conflict_v1($1,$2,$3)',
      [conflict.id, id.vehicleB, 'Tenant ativo divergente'],
      id.otherTenant,
    )).rejects.toMatchObject({ code: 'P0002' });
  });

  it('indexes every foreign-key lookup used by the conflict workflow', async () => {
    const rows = (await db.query<{ indexname: string }>(`
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname like 'idx_ssx_mapping_conflicts_%_fk'
      order by indexname
    `)).rows.map(row => row.indexname);
    expect(rows).toEqual([
      'idx_ssx_mapping_conflicts_account_fk',
      'idx_ssx_mapping_conflicts_linked_vehicle_fk',
      'idx_ssx_mapping_conflicts_provider_unit_fk',
      'idx_ssx_mapping_conflicts_resolved_by_fk',
      'idx_ssx_mapping_conflicts_resolved_vehicle_fk',
    ]);
  });
});
