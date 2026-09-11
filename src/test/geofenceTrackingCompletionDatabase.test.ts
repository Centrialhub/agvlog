// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260910190950_harden_geofence_tracking_completion.sql',
  'utf8',
);

function section(start: string, end: string) {
  return migration.slice(migration.indexOf(start) + start.length, migration.indexOf(end));
}

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema private; create schema cron;
    create table public.workspace_ssx_accounts(id integer);
    create table cron.job(jobid bigint primary key, jobname text not null);
    create function cron.unschedule(bigint) returns boolean language plpgsql as
      $$begin delete from cron.job where jobid=$1; return found; end$$;
    create function public.claim_workspace_ssx_dispatch_v1(integer,integer)
      returns integer language sql as $$select 1$$;
  `);
  await db.exec(section('-- BEGIN_TESTABLE_RADIUS_HELPER', '-- END_TESTABLE_RADIUS_HELPER'));
  await db.exec(section('-- BEGIN_TESTABLE_CURSOR_HELPER', '-- END_TESTABLE_CURSOR_HELPER'));
});

afterAll(async () => { await db?.close(); });

describe('geofence/tracking completion hardening', () => {
  it('applies end to end against the expected database contract', async () => {
    const fullDb = new PGlite();
    try {
      await fullDb.exec(`
        create role anon; create role authenticated; create role service_role;
        create schema private; create schema auth; create schema extensions;
        create domain extensions.geometry as jsonb;
        create domain extensions.geography as jsonb;
        create function auth.uid() returns uuid language sql stable as $$select null::uuid$$;
        create table public.dispatch_trips(id uuid,tenant_id uuid,vehicle_id uuid,status text,actual_start_at timestamptz);
        create table public.dispatch_stops(id uuid,tenant_id uuid,dispatch_trip_id uuid,stop_order integer,destination text,
          status text,actual_arrival_at timestamptz,updated_at timestamptz,latitude double precision,longitude double precision,
          location_source text,location_address text,location_provider text,location_accuracy_m double precision,
          location_confidence double precision,location_resolved_at timestamptz,location_resolved_by uuid,
          location_audit jsonb,geofence_radius_m double precision,location_exception_reason text,
          location_exception_at timestamptz,location_exception_by uuid);
        create table public.geofences(id uuid,tenant_id uuid,dispatch_stop_id uuid,scope_kind text,enabled boolean);
        create table public.geofence_states(tenant_id uuid,vehicle_id uuid,geofence_id uuid,is_inside boolean,
          last_checked_at timestamptz,last_changed_at timestamptz,pending_inside boolean,pending_count integer,
          last_point_at timestamptz,last_lat double precision,last_lng double precision,
          primary key(tenant_id,vehicle_id,geofence_id));
        create table public.geofence_radius_policies(tenant_id uuid,scope_kind text,category text,radius_m double precision,
          enter_margin_m double precision,exit_margin_m double precision,transition_confirmations integer);
        create function public.stop_terminal_statuses() returns text[] language sql immutable as
          $$select array['delivered','partial_delivery','returned','refused','failed','skipped','cancelled','completed']::text[]$$;
        create function public.dispatch_planned_route_v2(jsonb) returns uuid language sql as $$select null::uuid$$;
        create function public.dispatch_planned_route_v3(jsonb) returns uuid language sql as $$select null::uuid$$;
        create function public.process_geofence_position_batch_v2(uuid,uuid,jsonb) returns jsonb language sql as $$select '{}'::jsonb$$;
      `);
      await fullDb.exec(migration);
      const columns = await fullDb.query<{ column_name: string }>(`
        select column_name from information_schema.columns
        where table_name in ('dispatch_stops','geofence_states')
          and column_name in ('geofence_radius_is_override','last_point_key') order by column_name
      `);
      expect(columns.rows).toEqual([
        { column_name: 'geofence_radius_is_override' },
        { column_name: 'last_point_key' },
      ]);
    } finally {
      await fullDb.close();
    }
  });

  it('lets policy beat the legacy default unless the stop explicitly overrides it', async () => {
    const result = await db.query<{ inherited: number; explicit: number; fallback: number }>(`
      select
        private.effective_delivery_geofence_radius(false,500,725) inherited,
        private.effective_delivery_geofence_radius(true,500,725) explicit,
        private.effective_delivery_geofence_radius(false,500,null) fallback
    `);
    expect(result.rows[0]).toEqual({ inherited: 725, explicit: 500, fallback: 500 });
    expect(migration).toContain("v_stop?'geofence_radius_override'");
    expect(migration).toContain('geofence_radius_is_override=v_override');
  });

  it('builds a stable cursor key and uses timestamp plus key ordering', async () => {
    const result = await db.query<{ provider: string; fallback1: string; fallback2: string }>(`
      select
        private.geofence_position_cursor_key('2026-09-10T12:00:00Z',-23.5,-46.6,10,' hash-2 ') provider,
        private.geofence_position_cursor_key('2026-09-10T12:00:00Z',-23.5,-46.6,10,null) fallback1,
        private.geofence_position_cursor_key('2026-09-10T12:00:00Z',-23.6,-46.6,10,null) fallback2
    `);
    expect(result.rows[0].provider).toBe('p:hash-2');
    expect(result.rows[0].fallback1).toMatch(/^f:[a-f0-9]{32}$/);
    expect(result.rows[0].fallback1).not.toBe(result.rows[0].fallback2);
    expect(migration).toContain('distinct on(captured_at,point_key)');
    expect(migration).toContain("captured_at=v_state.last_point_at and point_key>coalesce(v_state.last_point_key,'')");
    expect(migration).toContain('last_point_key:=v_point.point_key');
  });

  it('removes the legacy tenant scheduler when the workspace dispatcher is canonical', async () => {
    await db.exec(`insert into cron.job values
      (1,'agvlog-schedule-tenants-every-minute'),(2,'agvlog-ssx-workspace-dispatcher')`);
    await db.exec(section('-- BEGIN_TESTABLE_SCHEDULER_GUARD', '-- END_TESTABLE_SCHEDULER_GUARD'));
    const result = await db.query<{ jobname: string }>('select jobname from cron.job order by jobid');
    expect(result.rows).toEqual([{ jobname: 'agvlog-ssx-workspace-dispatcher' }]);
  });
});
