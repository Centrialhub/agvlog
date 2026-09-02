// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { operationRpc } from './helpers/operationOutcomeDatabase';

const migration = readFileSync(
  'supabase/migrations/20260902011603_add_driver_event_history_cursor.sql',
  'utf8',
);
const ids = {
  tenant: '75000000-0000-4000-8000-000000000001',
  otherTenant: '75000000-0000-4000-8000-000000000002',
  user: '75000000-0000-4000-8000-000000000003',
  outsider: '75000000-0000-4000-8000-000000000004',
  driver: '75000000-0000-4000-8000-000000000005',
  otherDriver: '75000000-0000-4000-8000-000000000006',
  trip: '75000000-0000-4000-8000-000000000007',
  otherTrip: '75000000-0000-4000-8000-000000000008',
  stop: '75000000-0000-4000-8000-000000000009',
};

interface Page {
  tenant_id: string;
  actor_id: string;
  driver_id: string;
  trip_id: string | null;
  items: Array<Record<string, unknown>>;
  next_cursor: Record<string, unknown> | null;
}

let db: PGlite;

async function actor(user = ids.user) {
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [user]);
}

async function eventsPage(input: {
  trip?: string | null;
  limit?: number;
  cursor?: unknown;
  tenant?: string;
} = {}) {
  const result = await operationRpc<{ result: Page }>(db,
    'select public.list_driver_operational_events_page_v1($1,$2,$3,$4::jsonb) result',
    [
      input.tenant ?? ids.tenant,
      input.trip ?? null,
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

    create table public.tenant_memberships(tenant_id uuid,user_id uuid,active boolean not null,role text not null);
    create table public.drivers(id uuid primary key,tenant_id uuid,user_id uuid,active boolean not null);
    create table public.dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid);
    create table public.dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid);
    create table public.operational_events(
      id uuid primary key,tenant_id uuid,driver_id uuid,dispatch_trip_id uuid,dispatch_stop_id uuid,
      event_type text,severity text,description text,report_details jsonb,payload jsonb,
      created_at timestamptz not null
    );
    create function public.current_driver_id(_tenant_id uuid) returns uuid
      language sql stable security definer set search_path='public' as
      'select id from public.drivers where tenant_id=_tenant_id and user_id=auth.uid() and active limit 1';
    revoke all on function public.current_driver_id(uuid) from public,anon,authenticated,service_role;
    grant execute on function public.current_driver_id(uuid) to authenticated;

    alter table public.tenant_memberships enable row level security;
    alter table public.drivers enable row level security;
    alter table public.dispatch_trips enable row level security;
    alter table public.dispatch_stops enable row level security;
    alter table public.operational_events enable row level security;
    create policy membership_own on public.tenant_memberships for select to authenticated using(user_id=auth.uid());
    create policy drivers_own on public.drivers for select to authenticated using(user_id=auth.uid());
    create policy trips_own on public.dispatch_trips for select to authenticated using(driver_id=public.current_driver_id(tenant_id));
    create policy stops_own on public.dispatch_stops for select to authenticated using(dispatch_trip_id in(select id from public.dispatch_trips));
    create policy events_own on public.operational_events for select to authenticated using(
      driver_id=public.current_driver_id(tenant_id)
      or (driver_id is null and dispatch_trip_id in(select id from public.dispatch_trips))
      or (driver_id is null and dispatch_trip_id is null and dispatch_stop_id in(select id from public.dispatch_stops))
    );
    grant select on public.tenant_memberships,public.drivers,public.dispatch_trips,public.dispatch_stops,public.operational_events to authenticated;
  `);
  await db.exec(migration);
  await db.query('insert into tenant_memberships values($1,$2,true,\'driver\'),($1,$4,true,\'driver\'),($3,$4,true,\'driver\')',
    [ids.tenant, ids.user, ids.otherTenant, ids.outsider]);
  await db.query('insert into drivers values($1,$2,$3,true),($4,$2,$5,true)',
    [ids.driver, ids.tenant, ids.user, ids.otherDriver, ids.outsider]);
  await db.query('insert into dispatch_trips values($1,$2,$3),($4,$2,$5)',
    [ids.trip, ids.tenant, ids.driver, ids.otherTrip, ids.otherDriver]);
  await db.query('insert into dispatch_stops values($1,$2,$3)', [ids.stop, ids.tenant, ids.trip]);
  await db.query(`
    insert into operational_events(
      id,tenant_id,driver_id,dispatch_trip_id,dispatch_stop_id,event_type,severity,
      description,report_details,payload,created_at
    )
    select
      ('76000000-0000-4000-8000-' || lpad(series::text,12,'0'))::uuid,
      $1::uuid,$2::uuid,$3::uuid,null,'other','low','Evento ' || series,
      jsonb_build_object('label','OTHE','invoice',series),jsonb_build_object('scope','trip'),
      timestamptz '2026-01-01T00:00:00Z' + floor(series/2.0)*interval '1 minute'
    from generate_series(1,51) series
  `, [ids.tenant, ids.driver, ids.trip]);
  await db.query(`insert into operational_events values
    ('76999999-0000-4000-8000-000000000001',$1,null,$2,null,'other','medium','Somente viagem',null,null,'2026-02-01T00:00:00Z'),
    ('76999999-0000-4000-8000-000000000002',$1,null,null,$3,'other','high','Somente parada',null,null,'2026-02-02T00:00:00Z'),
    ('76999999-0000-4000-8000-000000000003',$1,$4,$2,null,'other','low','Outro motorista',null,null,'2026-02-03T00:00:00Z'),
    ('76999999-0000-4000-8000-000000000004',$5,null,null,null,'other','low','Outra empresa',null,null,'2026-02-04T00:00:00Z')`,
    [ids.tenant, ids.trip, ids.stop, ids.otherDriver, ids.otherTenant]);
}, 30_000);

afterAll(async () => { await db.close(); });
beforeEach(async () => { await db.exec('begin'); await actor(); });
afterEach(async () => { await db.exec('rollback'); });

describe('driver operational-event history cursor SQL/RLS boundary', { timeout: 30_000 }, () => {
  it('walks beyond fixed caps without gaps, duplicates or cross-driver/tenant rows', async () => {
    const first = await eventsPage();
    const second = await eventsPage({ cursor: first.next_cursor });
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(3);
    expect(second.next_cursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map(row => row.id)).size).toBe(53);
    expect(all.every(row => row.tenant_id === ids.tenant)).toBe(true);
    expect(JSON.stringify(all)).not.toContain('Outro motorista');
    expect(JSON.stringify(all)).not.toContain('Outra empresa');
  });

  it('includes explicit, trip-owned and stop-owned events in the selected trip', async () => {
    const first = await eventsPage({ trip: ids.trip });
    const second = await eventsPage({ trip: ids.trip, cursor: first.next_cursor });
    const descriptions = [...first.items, ...second.items].map(row => row.description);
    expect(descriptions).toContain('Somente viagem');
    expect(descriptions).toContain('Somente parada');
    expect(descriptions).toContain('Evento 1');
  });

  it('binds cursors to actor and trip and rejects an unowned trip', async () => {
    const first = await eventsPage({ limit: 2 });
    await expect(eventsPage({ limit: 2, trip: ids.trip, cursor: first.next_cursor }))
      .rejects.toThrow('driver_event_list_invalid_cursor');
    await expect(eventsPage({ trip: ids.otherTrip })).rejects.toThrow('driver_event_list_not_authorized');
  });

  it('denies missing membership, another tenant and another active driver', async () => {
    await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2', [ids.tenant, ids.user]);
    await expect(eventsPage()).rejects.toThrow('driver_event_list_not_authorized');
    await db.query('update tenant_memberships set active=true where tenant_id=$1 and user_id=$2', [ids.tenant, ids.user]);
    await expect(eventsPage({ tenant: ids.otherTenant })).rejects.toThrow('driver_event_list_not_authorized');
    await actor(ids.outsider);
    const other = await eventsPage();
    expect(other.driver_id).toBe(ids.otherDriver);
    expect(other.items).toHaveLength(1);
    expect(other.items[0].description).toBe('Outro motorista');
  });

  it('exposes only an invoker reader to authenticated callers', async () => {
    const result = await db.query<{
      public: boolean; anon: boolean; authenticated: boolean; service: boolean; definer: boolean;
    }>(`
      select
        has_function_privilege('public','public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)','execute') public,
        has_function_privilege('anon','public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)','execute') anon,
        has_function_privilege('authenticated','public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)','execute') authenticated,
        has_function_privilege('service_role','public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)','execute') service,
        (select prosecdef from pg_proc where oid='public.list_driver_operational_events_page_v1(uuid,uuid,integer,jsonb)'::regprocedure) definer
    `);
    expect(result.rows[0]).toEqual({ public: false, anon: false, authenticated: true, service: false, definer: false });
  });
});
