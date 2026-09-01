// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const legacyHash = '71506404e6bafbaeb3dc17a3e2530a1c';
const gpsHash = '74a957d4c16ef52847b8c7c6859f5e20';
const additive = readFileSync(
  'supabase/migrations/20260831232458_add_gps_driver_arrival_rpc.sql',
  'utf8',
);
const superseded = readFileSync(
  'supabase/migrations/20260830003721_require_driver_arrival_geolocation.sql',
  'utf8',
);
const cutover = readFileSync('docs/qa/DRIVER-ARRIVAL-GPS-CUTOVER-2026-08-31.sql', 'utf8');
const baseline = readFileSync('supabase/migrations/20260824224152_baseline.sql', 'utf8');
const legacyDefinition = baseline.match(
  /CREATE OR REPLACE FUNCTION public\.driver_mark_arrival\(_stop_id uuid\)[\s\S]*?END; \$function\$;/,
)?.[0];

if (!legacyDefinition) throw new Error('Legacy driver_mark_arrival definition not found in baseline');

let db: PGlite;

async function normalizedHash(signature: string) {
  const result = await db.query<{ hash: string }>(
    `select md5(replace(pg_get_functiondef(to_regprocedure($1)),chr(13),'')) hash`,
    [signature],
  );
  return result.rows[0].hash;
}

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable as
      $$select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid$$;
    create table public.dispatch_stops(
      id uuid primary key, dispatch_trip_id uuid, tenant_id uuid, status text,
      latitude double precision, longitude double precision,
      actual_arrival_at timestamptz, updated_at timestamptz
    );
    create table public.dispatch_trips(
      id uuid primary key, tenant_id uuid, driver_id uuid, status text,
      actual_start_at timestamptz, updated_at timestamptz
    );
    create table public.drivers(id uuid primary key, tenant_id uuid, user_id uuid, active boolean);
    create table public.dispatch_events(
      id uuid primary key default gen_random_uuid(), tenant_id uuid, dispatch_trip_id uuid,
      dispatch_stop_id uuid, event_type text, payload jsonb, created_by uuid,
      event_at timestamptz default now()
    );
    create function public._assert_driver_owns_trip(uuid) returns void
      language sql as $$select$$;
    create function public.stop_terminal_statuses() returns text[]
      language sql immutable as $$select array['delivered','refused','returned']::text[]$$;
    ${legacyDefinition}
    revoke all on function public.driver_mark_arrival(uuid)
      from public, anon, authenticated, service_role;
    grant execute on function public.driver_mark_arrival(uuid)
      to authenticated, service_role;
  `);
  await db.exec(superseded);
});

afterEach(async () => db?.close());

describe('driver arrival additive rollout in PostgreSQL', () => {
  it('matches the hosted legacy contract and installs GPS without removing it', async () => {
    expect(await normalizedHash('public.driver_mark_arrival(uuid)')).toBe(legacyHash);

    await db.exec(additive);

    expect(await normalizedHash('public.driver_mark_arrival(uuid)')).toBe(legacyHash);
    const installedGpsHash = await normalizedHash(
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)',
    );
    expect(installedGpsHash).toBe(gpsHash);
    const access = await db.query(`select
      has_function_privilege('authenticated','public.driver_mark_arrival(uuid)','execute') legacy_authenticated,
      has_function_privilege('service_role','public.driver_mark_arrival(uuid)','execute') legacy_service,
      has_function_privilege('anon','public.driver_mark_arrival(uuid)','execute') legacy_anon,
      has_function_privilege('authenticated','public.driver_mark_arrival(uuid,double precision,double precision,double precision)','execute') gps_authenticated,
      has_function_privilege('service_role','public.driver_mark_arrival(uuid,double precision,double precision,double precision)','execute') gps_service,
      has_function_privilege('anon','public.driver_mark_arrival(uuid,double precision,double precision,double precision)','execute') gps_anon`);
    expect(access.rows).toEqual([{
      legacy_authenticated:true, legacy_service:true, legacy_anon:false,
      gps_authenticated:true, gps_service:false, gps_anon:false,
    }]);
  });

  it('fails closed when the legacy definition changed', async () => {
    await db.exec(`create or replace function public.driver_mark_arrival(_stop_id uuid) returns uuid
      language sql security definer set search_path='' as $$select _stop_id$$`);
    await expect(db.exec(additive)).rejects.toThrow('legacy RPC hash changed');
    expect((await db.query(`select to_regprocedure(
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)') gps`)).rows)
      .toEqual([{gps:null}]);
  });

  it('fails closed when the legacy ACL changed', async () => {
    await db.exec('revoke execute on function public.driver_mark_arrival(uuid) from authenticated');
    await expect(db.exec(additive)).rejects.toThrow('legacy RPC ACL changed');
  });

  it('cuts over only after validating both overloads and keeps the GPS RPC', async () => {
    await db.exec(additive);
    await db.exec(cutover);
    expect((await db.query(`select
      to_regprocedure('public.driver_mark_arrival(uuid)') legacy,
      to_regprocedure('public.driver_mark_arrival(uuid,double precision,double precision,double precision)') gps`)).rows)
      .toEqual([{legacy:null,gps:'driver_mark_arrival(uuid,double precision,double precision,double precision)'}]);
    expect(await normalizedHash(
      'public.driver_mark_arrival(uuid,double precision,double precision,double precision)',
    )).toBe(gpsHash);
  });

  it('refuses cutover if the GPS function changed and preserves the legacy RPC', async () => {
    await db.exec(additive);
    await db.exec(`create or replace function public.driver_mark_arrival(
      _stop_id uuid, _latitude double precision, _longitude double precision, _accuracy_m double precision
    ) returns uuid language sql security definer set search_path=''
      as $$select _stop_id$$`);
    await expect(db.exec(cutover)).rejects.toThrow('GPS RPC hash changed');
    await db.exec('rollback');
    expect((await db.query(`select to_regprocedure('public.driver_mark_arrival(uuid)') legacy`)).rows)
      .toEqual([{legacy:'driver_mark_arrival(uuid)'}]);
  });
});
