// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { operationRpc } from './helpers/operationOutcomeDatabase';

const migration = readFileSync(
  'supabase/migrations/20260902010528_add_driver_load_history_cursor.sql',
  'utf8',
);
const ids = {
  tenant: '72000000-0000-4000-8000-000000000001',
  otherTenant: '72000000-0000-4000-8000-000000000002',
  user: '72000000-0000-4000-8000-000000000003',
  outsider: '72000000-0000-4000-8000-000000000004',
  driver: '72000000-0000-4000-8000-000000000005',
  otherDriver: '72000000-0000-4000-8000-000000000006',
  trip: '72000000-0000-4000-8000-000000000007',
  otherTrip: '72000000-0000-4000-8000-000000000008',
  vehicle: '72000000-0000-4000-8000-000000000009',
};

interface Page {
  tenant_id: string;
  actor_id: string;
  driver_id: string;
  search: string | null;
  status: string | null;
  items: Array<Record<string, unknown>>;
  next_cursor: Record<string, unknown> | null;
}

let db: PGlite;

async function actor(user = ids.user) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}

async function loadsPage(input: {
  search?: string | null;
  status?: string | null;
  limit?: number;
  cursor?: unknown;
  tenant?: string;
} = {}) {
  const result = await operationRpc<{ result: Page }>(db,
    'select public.list_driver_loads_page_v1($1,$2,$3,$4,$5::jsonb) result',
    [
      input.tenant ?? ids.tenant,
      input.search ?? null,
      input.status ?? null,
      input.limit ?? 50,
      input.cursor ? JSON.stringify(input.cursor) : null,
    ],
  );
  return result.rows[0].result;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as 'select nullif(current_setting(''request.jwt.claim.sub'',true),'''')::uuid';
    grant usage on schema auth to authenticated;
    grant execute on function auth.uid() to authenticated;

    create table public.tenant_memberships(tenant_id uuid,user_id uuid,active boolean not null);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean not null);
    create table public.vehicles(id uuid primary key,tenant_id uuid,plate text,nickname text);
    create table public.dispatch_trips(
      id uuid primary key,tenant_id uuid,driver_id uuid,status text,
      actual_start_at timestamptz,created_at timestamptz not null
    );
    create table public.loads(
      id uuid primary key,tenant_id uuid,load_number text,origin text,destination text,status text,
      scheduled_load_at timestamptz,total_pallet_count numeric,total_weight_kg numeric,
      created_at timestamptz not null,vehicle_id uuid,driver_id uuid,trip_id uuid,on_hold boolean not null
    );
    create table public.dispatch_trip_loads(
      id uuid primary key,tenant_id uuid,load_id uuid,dispatch_trip_id uuid,created_at timestamptz not null
    );
    create function public.current_driver_id(_tenant_id uuid) returns uuid
      language sql stable security definer set search_path='public' as
      'select id from public.drivers where tenant_id=_tenant_id and user_id=auth.uid() and active limit 1';
    revoke all on function public.current_driver_id(uuid) from public,anon,authenticated,service_role;
    grant execute on function public.current_driver_id(uuid) to authenticated;

    alter table public.tenant_memberships enable row level security;
    alter table public.drivers enable row level security;
    alter table public.vehicles enable row level security;
    alter table public.dispatch_trips enable row level security;
    alter table public.loads enable row level security;
    alter table public.dispatch_trip_loads enable row level security;
    create policy membership_own on public.tenant_memberships for select to authenticated
      using(user_id=auth.uid());
    create policy drivers_own on public.drivers for select to authenticated
      using(user_id=auth.uid());
    create policy vehicles_member on public.vehicles for select to authenticated
      using(exists(select 1 from public.tenant_memberships m where m.tenant_id=vehicles.tenant_id and m.user_id=auth.uid() and m.active));
    create policy trips_own on public.dispatch_trips for select to authenticated
      using(driver_id=public.current_driver_id(tenant_id));
    create policy loads_own on public.loads for select to authenticated
      using(
        loads.driver_id=public.current_driver_id(loads.tenant_id)
        or loads.trip_id in(select trip.id from public.dispatch_trips trip where trip.driver_id=public.current_driver_id(trip.tenant_id))
        or loads.id in(select link.load_id from public.dispatch_trip_loads link join public.dispatch_trips trip on trip.id=link.dispatch_trip_id where trip.driver_id=public.current_driver_id(trip.tenant_id))
      );
    create policy links_own on public.dispatch_trip_loads for select to authenticated
      using(dispatch_trip_loads.dispatch_trip_id in(select trip.id from public.dispatch_trips trip where trip.driver_id=public.current_driver_id(trip.tenant_id)));
    grant select on public.tenant_memberships,public.drivers,public.vehicles,public.dispatch_trips,public.loads,public.dispatch_trip_loads to authenticated;
  `);
  await db.exec(migration);
  await db.query('insert into tenant_memberships values($1,$2,true),($1,$4,true),($3,$4,true)',
    [ids.tenant, ids.user, ids.otherTenant, ids.outsider]);
  await db.query('insert into drivers values($1,$2,$3,true),($4,$2,$5,true)',
    [ids.driver, ids.tenant, ids.user, ids.otherDriver, ids.outsider]);
  await db.query('insert into vehicles values($1,$2,$3,$4)',
    [ids.vehicle, ids.tenant, 'AAA1A11', 'Principal']);
  await db.query("insert into dispatch_trips values($1,$2,$3,'in_transit','2026-09-01T10:00:00Z','2026-09-01T09:00:00Z'),($4,$2,$5,'planned',null,'2026-09-01T09:00:00Z')",
    [ids.trip, ids.tenant, ids.driver, ids.otherTrip, ids.otherDriver]);
  await db.query(`
    insert into loads(id,tenant_id,load_number,origin,destination,status,scheduled_load_at,total_pallet_count,total_weight_kg,created_at,vehicle_id,driver_id,trip_id,on_hold)
    select
      ('73000000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
      $1::uuid,
      case when series=51 then 'SPECIAL-0051' else 'LOAD-' || lpad(series::text,4,'0') end,
      'Montes Claros','Belo Horizonte',case when series=51 then 'delivered' else 'in_transit' end,
      null,series,series*100,
      timestamptz '2026-01-01T00:00:00Z' + floor(series/2.0)*interval '1 minute',
      $2::uuid,$3::uuid,null,false
    from generate_series(1,51) series
  `, [ids.tenant, ids.vehicle, ids.driver]);
  await db.query(`insert into loads values
    ('73999999-0000-4000-8000-000000000001',$1,'HOLD','X','Y','planned',null,0,0,now(),$2,$3,null,true),
    ('73999999-0000-4000-8000-000000000002',$1,'CONTRADICTORY','X','Y','planned',null,0,0,now(),$2,$3,null,false),
    ('73999999-0000-4000-8000-000000000003',$4,'OTHER-TENANT','X','Y','planned',null,0,0,now(),null,null,null,false)`,
    [ids.tenant, ids.vehicle, ids.driver, ids.otherTenant]);
  await db.query("insert into dispatch_trip_loads values(gen_random_uuid(),$1,'73000000-0000-4000-8000-000000000051',$2,'2026-09-01T10:00:00Z'),(gen_random_uuid(),$1,'73999999-0000-4000-8000-000000000002',$3,'2026-09-01T10:00:00Z')",
    [ids.tenant, ids.trip, ids.otherTrip]);
}, 30_000);

afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('begin'); await actor(); });
afterEach(async () => { await db.exec('rollback'); });

describe('driver load history cursor SQL/RLS boundary', { timeout: 30_000 }, () => {
  it('walks beyond the Data API cap without gaps, duplicates, held or cross-tenant rows', async () => {
    const first = await loadsPage();
    const second = await loadsPage({ cursor: first.next_cursor });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(2);
    expect(second.next_cursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map(row => row.id)).size).toBe(52);
    expect(all.every(row => row.tenant_id === ids.tenant)).toBe(true);
    expect(JSON.stringify(all)).not.toContain('HOLD');
    expect(all.find(row => row.load_number === 'CONTRADICTORY')?.dispatch_trip_loads).toEqual([]);
  });

  it('returns canonical trip/vehicle context and applies literal search plus status filters', async () => {
    const page = await loadsPage({ search: 'SPECIAL-0051', status: 'delivered' });
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({
      load_number: 'SPECIAL-0051',
      vehicles: { plate: 'AAA1A11', nickname: 'Principal' },
      dispatch_trip_loads: [{
        dispatch_trip_id: ids.trip,
        dispatch_trips: { status: 'in_transit' },
      }],
    });
    expect((await loadsPage({ search: '%' })).items).toEqual([]);
  });

  it('binds cursors to the actor/filter scope and rejects invalid status', async () => {
    const first = await loadsPage({ limit: 2 });
    await expect(loadsPage({ limit: 2, cursor: first.next_cursor, status: 'delivered' }))
      .rejects.toThrow('driver_load_list_invalid_cursor');
    await expect(loadsPage({ status: 'invented' })).rejects.toThrow('driver_load_list_invalid_status');
  });

  it('denies missing membership, another tenant and another active driver', async () => {
    await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2', [ids.tenant, ids.user]);
    await expect(loadsPage()).rejects.toThrow('driver_load_list_not_authorized');
    await db.query('update tenant_memberships set active=true where tenant_id=$1 and user_id=$2', [ids.tenant, ids.user]);
    await expect(loadsPage({ tenant: ids.otherTenant })).rejects.toThrow('driver_load_list_not_authorized');
    await actor(ids.outsider);
    const other = await loadsPage();
    expect(other.driver_id).toBe(ids.otherDriver);
    expect(other.items).toEqual([]);
  });

  it('exposes only an invoker reader to authenticated callers', async () => {
    const result = await db.query<{ public: boolean; anon: boolean; authenticated: boolean; service: boolean; definer: boolean }>(`
      select
        has_function_privilege('public','public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)','execute') public,
        has_function_privilege('anon','public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)','execute') anon,
        has_function_privilege('authenticated','public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)','execute') authenticated,
        has_function_privilege('service_role','public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)','execute') service,
        (select prosecdef from pg_proc where oid='public.list_driver_loads_page_v1(uuid,text,text,integer,jsonb)'::regprocedure) definer
    `);
    expect(result.rows[0]).toEqual({ public: false, anon: false, authenticated: true, service: false, definer: false });
  });
});
