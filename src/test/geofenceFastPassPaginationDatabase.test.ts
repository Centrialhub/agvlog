// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260910195852_preserve_geofence_fast_pass.sql',
  'utf8',
);
const queue = readFileSync('supabase/functions/agvlog-run-queue/index.ts', 'utf8');

function section(start: string, end: string) {
  const from = migration.indexOf(start);
  const to = migration.indexOf(end);
  if (from < 0 || to <= from) throw new Error(`Missing migration section ${start}`);
  return migration.slice(from + start.length, to);
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema private;
    create schema extensions;

    create domain extensions.geometry as jsonb;
    create domain extensions.geography as jsonb;

    create function extensions.st_makepoint(double precision,double precision)
      returns jsonb language sql immutable
      as $$select jsonb_build_object('x',$1,'y',$2)$$;
    create function extensions.st_setsrid(jsonb,integer)
      returns extensions.geometry language sql immutable as $$select $1$$;
    create function extensions.test_distance(jsonb,jsonb)
      returns double precision language sql immutable as $$
        select sqrt(
          power(($1->>'x')::double precision - ($2->>'x')::double precision,2)
          + power(($1->>'y')::double precision - ($2->>'y')::double precision,2)
        )
      $$;
    create function extensions.st_covers(jsonb,jsonb)
      returns boolean language sql immutable as $$
        select extensions.test_distance($1,$2) <= ($1->>'radius')::double precision
      $$;
    create function extensions.st_dwithin(jsonb,jsonb,double precision)
      returns boolean language sql immutable as $$
        select extensions.test_distance($1,$2) <= ($1->>'radius')::double precision + $3
      $$;
    create function extensions.st_boundary(jsonb)
      returns extensions.geometry language sql immutable as $$select $1$$;
    create function extensions.st_distance(jsonb,jsonb)
      returns double precision language sql immutable as $$
        select abs(
          ($1->>'radius')::double precision - extensions.test_distance($1,$2)
        )
      $$;

    create function private.geofence_position_cursor_key(
      timestamptz,double precision,double precision,double precision,text
    ) returns text language sql immutable set search_path='' as $$
      select case when nullif(btrim($5),'') is not null then 'p:' || btrim($5)
        else 'f:' || pg_catalog.md5(pg_catalog.concat_ws(
          '|',extract(epoch from $1)::text,$2::text,$3::text,coalesce($4::text,'')
        )) end
    $$;

    create table public.vehicles(id uuid primary key,tenant_id uuid not null);
    create table public.positions_raw(
      id uuid primary key,tenant_id uuid not null,vehicle_id uuid not null,
      captured_at timestamptz not null,received_at timestamptz not null,
      lat double precision not null,lng double precision not null,speed double precision,
      heading double precision,telemetry jsonb,provider_payload_hash text
    );
    create table public.dispatch_trips(id uuid,tenant_id uuid,vehicle_id uuid,status text);
    create table public.dispatch_stops(
      id uuid,tenant_id uuid,dispatch_trip_id uuid,status text
    );
    create table public.geofences(
      id uuid primary key,tenant_id uuid not null,name text not null,enabled boolean not null,
      scope_kind text not null,dispatch_stop_id uuid,geometry extensions.geometry,
      enter_margin_m double precision not null,exit_margin_m double precision not null,
      transition_confirmations integer not null
    );
    create table public.geofence_states(
      tenant_id uuid not null,vehicle_id uuid not null,geofence_id uuid not null,
      is_inside boolean not null,last_changed_at timestamptz,last_checked_at timestamptz,
      pending_inside boolean,pending_count integer not null default 0,
      pending_bracketed_from_outside boolean not null default false,
      last_point_at timestamptz,last_point_key text,last_lat double precision,last_lng double precision,
      primary key(tenant_id,vehicle_id,geofence_id)
    );
    create table public.geofence_events(
      tenant_id uuid,vehicle_id uuid,geofence_id uuid,direction text,event_at timestamptz,payload jsonb
    );
    create table public.events(
      tenant_id uuid,vehicle_id uuid,event_type text,severity text,source text,event_at timestamptz,payload jsonb
    );
    create table public.alert_rules(
      id uuid,tenant_id uuid,enabled boolean,rule_type text,params jsonb
    );
    create table public.alert_instances(
      tenant_id uuid,vehicle_id uuid,rule_id uuid,status text,source text,opened_at timestamptz
    );
    create function public.stop_terminal_statuses() returns text[] language sql immutable
      as $$select array['delivered','cancelled']::text[]$$;

    insert into public.vehicles values(
      '10000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001'
    );
  `);
  await db.exec(section('-- BEGIN_TESTABLE_POSITION_PAGE', '-- END_TESTABLE_POSITION_PAGE'));
  await db.exec(section('-- BEGIN_TESTABLE_FAST_PASS', '-- END_TESTABLE_FAST_PASS'));
});

afterAll(async () => { await db?.close(); });

describe('geofence fast-pass and stable processing pagination', () => {
  it('returns all 5,001 positions over a stable two-page cursor without losing the tail', async () => {
    await db.exec(`
      insert into public.positions_raw(
        id,tenant_id,vehicle_id,captured_at,received_at,lat,lng,provider_payload_hash
      )
      select md5(i::text)::uuid,
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-10T12:00:00Z'::timestamptz + ((i / 3)::text || ' milliseconds')::interval,
        '2026-09-10T12:00:01Z'::timestamptz,
        0,0,lpad(i::text,8,'0')
      from generate_series(1,5001) i;
    `);

    const first = await db.query<{
      position_payload: { provider_payload_hash: string };
      position_captured_at: string | Date;
      position_point_key: string;
    }>(`
      select * from public.read_vehicle_position_processing_page_v1(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-10T11:59:00Z','2026-09-10T12:01:00Z',null,null,5000
      )
    `);
    expect(first.rows).toHaveLength(5000);

    const cursor = first.rows.at(-1)!;
    const cursorCapturedAt = cursor.position_captured_at instanceof Date
      ? cursor.position_captured_at.toISOString()
      : cursor.position_captured_at;
    const second = await db.query<{
      position_payload: { provider_payload_hash: string };
      position_captured_at: string | Date;
      position_point_key: string;
    }>(`
      select * from public.read_vehicle_position_processing_page_v1(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '2026-09-10T11:59:00Z','2026-09-10T12:01:00Z',
        '${cursorCapturedAt}','${cursor.position_point_key}',5000
      )
    `);
    expect(second.rows).toHaveLength(1);
    expect(new Set([...first.rows, ...second.rows].map(row => row.position_payload.provider_payload_hash)).size)
      .toBe(5001);
    const secondCapturedAt = second.rows[0].position_captured_at instanceof Date
      ? second.rows[0].position_captured_at.toISOString()
      : second.rows[0].position_captured_at;
    expect(second.rows[0].position_point_key > cursor.position_point_key
      || secondCapturedAt > cursorCapturedAt).toBe(true);
  });

  it('emits enter and exit for one deep-inside sample bracketed by clear outside samples', async () => {
    await db.exec(`
      insert into public.geofences values(
        '30000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'Entrega rápida',true,'fleet',null,
        '{"x":0,"y":0,"radius":10}'::jsonb,2,3,2
      );
    `);
    const result = await db.query<{ result: { transition_count: number } }>(`
      select public.process_geofence_position_batch_v2(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '[
          {"captured_at":"2026-09-10T13:00:00Z","lat":0,"lng":20,"provider_payload_hash":"outside-before"},
          {"captured_at":"2026-09-10T13:00:05Z","lat":0,"lng":0,"provider_payload_hash":"inside-once"},
          {"captured_at":"2026-09-10T13:00:10Z","lat":0,"lng":20,"provider_payload_hash":"outside-after"}
        ]'::jsonb
      ) result
    `);
    expect(result.rows[0].result.transition_count).toBe(2);
    const events = await db.query<{ direction: string; reason: string }>(`
      select direction,payload->>'transition_reason' reason
      from public.geofence_events order by event_at
    `);
    expect(events.rows).toEqual([
      { direction: 'enter', reason: 'fast_pass_bracketed' },
      { direction: 'exit', reason: 'fast_pass_bracketed' },
    ]);

    const rerun = await db.query<{ result: { transition_count: number } }>(`
      select public.process_geofence_position_batch_v2(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '[
          {"captured_at":"2026-09-10T13:00:00Z","lat":0,"lng":20,"provider_payload_hash":"outside-before"},
          {"captured_at":"2026-09-10T13:00:05Z","lat":0,"lng":0,"provider_payload_hash":"inside-once"},
          {"captured_at":"2026-09-10T13:00:10Z","lat":0,"lng":20,"provider_payload_hash":"outside-after"}
        ]'::jsonb
      ) result
    `);
    expect(rerun.rows[0].result.transition_count).toBe(0);
    expect((await db.query<{ geofence_count: number; mirror_count: number }>(`
      select
        (select count(*)::int from public.geofence_events) geofence_count,
        (select count(*)::int from public.events
          where event_type in ('geofence_enter','geofence_exit')) mirror_count
    `)).rows[0]).toEqual({ geofence_count: 2, mirror_count: 2 });
  });

  it('does not convert a boundary-margin oscillation into a fast pass', async () => {
    await db.exec('truncate public.geofence_events,public.events,public.geofence_states');
    const result = await db.query<{ result: { transition_count: number } }>(`
      select public.process_geofence_position_batch_v2(
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000001',
        '[
          {"captured_at":"2026-09-10T14:00:00Z","lat":0,"lng":20,"provider_payload_hash":"edge-before"},
          {"captured_at":"2026-09-10T14:00:05Z","lat":0,"lng":0,"provider_payload_hash":"edge-inside"},
          {"captured_at":"2026-09-10T14:00:10Z","lat":0,"lng":9,"provider_payload_hash":"edge-margin"}
        ]'::jsonb
      ) result
    `);
    expect(result.rows[0].result.transition_count).toBe(0);
    expect((await db.query<{ count: number }>(
      'select count(*)::int count from public.geofence_events',
    )).rows[0].count).toBe(0);
  });

  it('wires the Edge worker to page and process every page under the RPC limit', () => {
    expect(queue).toContain('const POSITION_PROCESSING_PAGE_SIZE = 5000');
    expect(queue).toContain('while (true)');
    expect(queue).toContain('read_vehicle_position_processing_page_v1');
    expect(queue).toContain('if (page.length === 0) break');
    expect(queue).not.toContain('page.length < POSITION_PROCESSING_PAGE_SIZE');
    expect(queue).toContain('afterCapturedAt = last.position_captured_at');
    expect(queue).toContain('afterPointKey = last.position_point_key');
    expect(queue).toContain('checkGeofences(supabase, tenantId, vehicleId, pagePositions)');
    expect(queue).not.toMatch(/from\("positions_raw"\)[\s\S]{0,300}limit\(5000\)/);
  });

  it('preserves canonical geofence event mirrors when the engine window is rebuilt', () => {
    expect(queue).toMatch(
      /from\("events"\)[\s\S]{0,250}\.eq\("source", "engine"\)[\s\S]{0,120}\.not\("event_type", "in", '\("geofence_enter","geofence_exit"\)'\)/,
    );
  });
});
