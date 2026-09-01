// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260901183111_harden_position_read_contracts.sql',
  'utf8',
);

const ids = {
  tenantA: '20000000-0000-4000-8000-000000000001',
  tenantB: '20000000-0000-4000-8000-000000000002',
  operatorA: '10000000-0000-4000-8000-000000000001',
  driverA: '10000000-0000-4000-8000-000000000002',
  clientA: '10000000-0000-4000-8000-000000000003',
  operatorB: '10000000-0000-4000-8000-000000000004',
  ownerA: '10000000-0000-4000-8000-000000000005',
  adminA: '10000000-0000-4000-8000-000000000006',
  driverRowA: '60000000-0000-4000-8000-000000000001',
  vehicleA: '50000000-0000-4000-8000-000000000001',
  vehicleA2: '50000000-0000-4000-8000-000000000002',
  vehicleB: '50000000-0000-4000-8000-000000000003',
  tripA: '80000000-0000-4000-8000-000000000001',
  rawA1: '90000000-0000-4000-8000-000000000001',
  rawA2: '90000000-0000-4000-8000-000000000002',
  rawAOther: '90000000-0000-4000-8000-000000000003',
  rawB: '90000000-0000-4000-8000-000000000004',
};

let db: PGlite;

async function resetRole() {
  await db.exec('reset role').catch(() => undefined);
}

async function asAuthenticated<T>(actor: string, query: () => Promise<T>): Promise<T> {
  await resetRole();
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [actor]);
  await db.exec('set role authenticated');
  try {
    return await query();
  } finally {
    await resetRole();
  }
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    grant usage on schema auth to anon, authenticated, service_role;
    create function auth.uid()
    returns uuid
    language sql
    stable
    as $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;

    create type public.app_role as enum ('owner', 'admin', 'operator', 'client', 'driver');

    create table public.tenant_memberships (
      tenant_id uuid not null,
      user_id uuid not null,
      role public.app_role not null,
      active boolean not null default true
    );

    create function public.is_user_internal_role(_tenant_id uuid)
    returns boolean
    language sql
    stable
    security definer
    set search_path = ''
    as $$
      select exists (
        select 1
        from public.tenant_memberships tm
        where tm.user_id = (select auth.uid())
          and tm.tenant_id = _tenant_id
          and tm.role in ('owner', 'admin', 'operator')
          and tm.active = true
      )
    $$;

    create table public.drivers (
      id uuid primary key,
      tenant_id uuid not null,
      user_id uuid,
      active boolean not null default true
    );

    create table public.dispatch_trips (
      id uuid primary key,
      tenant_id uuid not null,
      vehicle_id uuid,
      driver_id uuid,
      status text not null
    );

    create table public.positions_raw (
      id uuid primary key,
      tenant_id uuid not null,
      vehicle_id uuid not null,
      captured_at timestamptz not null,
      received_at timestamptz not null default now(),
      lat double precision not null,
      lng double precision not null,
      speed double precision,
      heading double precision,
      telemetry jsonb,
      provider_payload_hash text
    );

    create table public.positions_last (
      tenant_id uuid not null,
      vehicle_id uuid not null,
      lat double precision not null,
      lng double precision not null,
      speed double precision,
      heading double precision,
      captured_at timestamptz not null,
      received_at timestamptz not null default now(),
      telemetry_snapshot jsonb,
      source jsonb,
      primary key (tenant_id, vehicle_id)
    );

    create table public.vehicles_state (
      vehicle_id uuid not null,
      tenant_id uuid not null,
      last_position_id uuid,
      lat double precision,
      lng double precision,
      speed double precision not null default 0,
      heading double precision,
      movement_state text not null default 'unknown',
      last_movement_at timestamptz,
      last_position_at timestamptz,
      stopped_since timestamptz,
      stopped_duration_seconds integer,
      updated_at timestamptz not null default now(),
      primary key (tenant_id, vehicle_id)
    );

    alter table public.positions_raw enable row level security;
    alter table public.positions_last enable row level security;
    alter table public.vehicles_state enable row level security;
    grant all on public.positions_raw, public.positions_last, public.vehicles_state to authenticated;

    create policy "Members can view positions_raw"
      on public.positions_raw for select to authenticated using (true);
    create policy "Members can view vehicles_state"
      on public.vehicles_state for select to authenticated using (true);
    create policy positions_last_select_internal
      on public.positions_last for select to authenticated using (true);
    create policy positions_last_select_driver
      on public.positions_last for select to authenticated using (true);
  `);
  await db.exec(migration);

  await db.query(
    `insert into public.tenant_memberships (tenant_id, user_id, role) values
      ($1, $2, 'operator'), ($1, $3, 'driver'), ($1, $4, 'client'),
      ($5, $6, 'operator'), ($1, $7, 'owner'), ($1, $8, 'admin')`,
    [
      ids.tenantA, ids.operatorA, ids.driverA, ids.clientA,
      ids.tenantB, ids.operatorB, ids.ownerA, ids.adminA,
    ],
  );
  await db.query(
    'insert into public.drivers (id, tenant_id, user_id) values ($1, $2, $3)',
    [ids.driverRowA, ids.tenantA, ids.driverA],
  );
  await db.query(
    "insert into public.dispatch_trips (id, tenant_id, vehicle_id, driver_id, status) values ($1, $2, $3, $4, 'in_transit')",
    [ids.tripA, ids.tenantA, ids.vehicleA, ids.driverRowA],
  );
  await db.query(
    `insert into public.positions_raw
      (id, tenant_id, vehicle_id, captured_at, lat, lng, speed, heading, telemetry, provider_payload_hash)
     values
      ($1, $2, $3, '2026-09-01T10:00:00Z', -23.0, -46.0, 20, 90, '{"token":"secret"}', 'hash-a1'),
      ($4, $2, $3, '2026-09-01T10:05:00Z', -23.1, -46.1, 25, 91, '{"token":"secret"}', 'hash-a2'),
      ($5, $2, $6, '2026-09-01T10:06:00Z', -23.2, -46.2, 30, 92, '{"token":"secret"}', 'hash-a3'),
      ($7, $8, $9, '2026-09-01T10:07:00Z', -24.0, -47.0, 40, 93, '{"token":"secret"}', 'hash-b')`,
    [
      ids.rawA1, ids.tenantA, ids.vehicleA, ids.rawA2, ids.rawAOther, ids.vehicleA2,
      ids.rawB, ids.tenantB, ids.vehicleB,
    ],
  );
  await db.query(
    `insert into public.positions_last
      (tenant_id, vehicle_id, lat, lng, speed, heading, captured_at, telemetry_snapshot, source)
     values
      ($1, $2, -23.1, -46.1, 25, 91, '2026-09-01T10:05:00Z', '{"private":true}', '{"provider":"SSX"}'),
      ($1, $3, -23.2, -46.2, 30, 92, '2026-09-01T10:06:00Z', '{"private":true}', '{"provider":"SSX"}'),
      ($4, $5, -24.0, -47.0, 40, 93, '2026-09-01T10:07:00Z', '{"private":true}', '{"provider":"SSX"}')`,
    [ids.tenantA, ids.vehicleA, ids.vehicleA2, ids.tenantB, ids.vehicleB],
  );
  await db.query(
    `insert into public.vehicles_state
      (tenant_id, vehicle_id, lat, lng, speed, movement_state, last_position_at)
     values
      ($1, $2, -23.1, -46.1, 25, 'moving', '2026-09-01T10:05:00Z'),
      ($1, $3, -23.2, -46.2, 0, 'stopped', '2026-09-01T10:06:00Z'),
      ($4, $5, -24.0, -47.0, 40, 'moving', '2026-09-01T10:07:00Z')`,
    [ids.tenantA, ids.vehicleA, ids.vehicleA2, ids.tenantB, ids.vehicleB],
  );
});

afterAll(async () => {
  await db.close();
});

describe('position read privacy contract', () => {
  it('limits raw/state fleet reads to the owner/admin/operator tenant and hides provider columns', async () => {
    for (const actor of [ids.ownerA, ids.adminA, ids.operatorA]) {
      await asAuthenticated(actor, async () => {
        const raw = await db.query<{ tenant_id: string; vehicle_id: string }>(
          'select tenant_id, vehicle_id from public.positions_raw order by vehicle_id, captured_at',
        );
        expect(raw.rows).toHaveLength(3);
        expect(new Set(raw.rows.map((row) => row.tenant_id))).toEqual(new Set([ids.tenantA]));

        const states = await db.query<{ tenant_id: string }>(
          'select tenant_id from public.vehicles_state order by vehicle_id',
        );
        expect(states.rows).toHaveLength(2);
        expect(states.rows.every((row) => row.tenant_id === ids.tenantA)).toBe(true);

        await expect(db.query('select telemetry from public.positions_raw')).rejects.toThrow(/permission denied/i);
        await expect(db.query('select telemetry_snapshot from public.positions_last')).rejects.toThrow(/permission denied/i);
        await expect(db.query('select last_position_id from public.vehicles_state')).rejects.toThrow(/permission denied/i);
      });
    }
  });

  it('gives a driver only the current position of the assigned active-trip vehicle', async () => {
    await asAuthenticated(ids.driverA, async () => {
      expect((await db.query('select id from public.positions_raw')).rows).toEqual([]);
      expect((await db.query('select vehicle_id from public.vehicles_state')).rows).toEqual([]);
      expect((await db.query<{ vehicle_id: string }>('select vehicle_id from public.positions_last')).rows)
        .toEqual([{ vehicle_id: ids.vehicleA }]);
    });

    await db.query("update public.dispatch_trips set status = 'completed' where id = $1", [ids.tripA]);
    await asAuthenticated(ids.driverA, async () => {
      expect((await db.query('select vehicle_id from public.positions_last')).rows).toEqual([]);
    });
    await db.query("update public.dispatch_trips set status = 'in_transit' where id = $1", [ids.tripA]);
  });

  it('returns no fleet telemetry to a legacy client membership', async () => {
    await asAuthenticated(ids.clientA, async () => {
      expect((await db.query('select id from public.positions_raw')).rows).toEqual([]);
      expect((await db.query('select vehicle_id from public.positions_last')).rows).toEqual([]);
      expect((await db.query('select vehicle_id from public.vehicles_state')).rows).toEqual([]);
    });
  });

  it('paginates history by a stable cursor and rejects driver/cross-tenant calls', async () => {
    const first = await asAuthenticated(ids.operatorA, async () => (
      await db.query<{ id: string; captured_at: Date }>(
        `select id, captured_at
         from public.list_vehicle_position_history_v1(
           $1, $2, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', null, null, 1
         )`,
        [ids.tenantA, ids.vehicleA],
      )
    ).rows);
    expect(first).toHaveLength(1);
    expect(first[0].id).toBe(ids.rawA1);

    const second = await asAuthenticated(ids.operatorA, async () => (
      await db.query<{ id: string }>(
        `select id
         from public.list_vehicle_position_history_v1(
           $1, $2, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', $3, $4, 1
         )`,
        [ids.tenantA, ids.vehicleA, first[0].captured_at, first[0].id],
      )
    ).rows);
    expect(second).toEqual([{ id: ids.rawA2 }]);

    await expect(asAuthenticated(ids.operatorA, () => db.query(
      `select * from public.list_vehicle_position_history_v1(
        $1, $2, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'
      )`,
      [ids.tenantB, ids.vehicleB],
    ))).rejects.toThrow(/forbidden/i);

    await expect(asAuthenticated(ids.driverA, () => db.query(
      `select * from public.list_vehicle_position_history_v1(
        $1, $2, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z'
      )`,
      [ids.tenantA, ids.vehicleA],
    ))).rejects.toThrow(/forbidden/i);
  });

  it('enforces bounded arguments and least-privilege ACLs', async () => {
    await expect(asAuthenticated(ids.operatorA, () => db.query(
      `select * from public.list_vehicle_position_history_v1(
        $1, $2, '2026-09-01T00:00:00Z', '2026-09-02T00:00:00Z', null, null, 501
      )`,
      [ids.tenantA, ids.vehicleA],
    ))).rejects.toThrow(/invalid_page_size/i);

    const privileges = await db.query<{
      anon_execute: boolean;
      authenticated_execute: boolean;
      anon_raw_safe_select: boolean;
      anon_position_safe_select: boolean;
      anon_state_safe_select: boolean;
      raw_safe_select: boolean;
      raw_payload_select: boolean;
      raw_insert: boolean;
      service_insert: boolean;
      security_definer: boolean;
    }>(`
      select
        has_function_privilege(
          'anon',
          'public.list_vehicle_position_history_v1(uuid,uuid,timestamptz,timestamptz,timestamptz,uuid,integer)',
          'execute'
        ) anon_execute,
        has_function_privilege(
          'authenticated',
          'public.list_vehicle_position_history_v1(uuid,uuid,timestamptz,timestamptz,timestamptz,uuid,integer)',
          'execute'
        ) authenticated_execute,
        has_column_privilege('anon', 'public.positions_raw', 'lat', 'select') anon_raw_safe_select,
        has_column_privilege('anon', 'public.positions_last', 'lat', 'select') anon_position_safe_select,
        has_column_privilege('anon', 'public.vehicles_state', 'lat', 'select') anon_state_safe_select,
        has_column_privilege('authenticated', 'public.positions_raw', 'lat', 'select') raw_safe_select,
        has_column_privilege('authenticated', 'public.positions_raw', 'telemetry', 'select') raw_payload_select,
        has_table_privilege('authenticated', 'public.positions_raw', 'insert') raw_insert,
        has_table_privilege('service_role', 'public.positions_raw', 'insert') service_insert,
        p.prosecdef security_definer
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
      where n.nspname = 'public' and p.proname = 'list_vehicle_position_history_v1'
    `);
    expect(privileges.rows[0]).toEqual({
      anon_execute: false,
      authenticated_execute: true,
      anon_raw_safe_select: false,
      anon_position_safe_select: false,
      anon_state_safe_select: false,
      raw_safe_select: true,
      raw_payload_select: false,
      raw_insert: false,
      service_insert: true,
      security_definer: false,
    });
  });
});
