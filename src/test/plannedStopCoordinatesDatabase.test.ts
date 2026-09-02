// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260902021429_harden_planned_stop_coordinates.sql',
  'utf8',
);

let db: PGlite;

beforeEach(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.dispatch_stops(
      id uuid primary key default gen_random_uuid(),
      status text not null,
      latitude numeric,
      longitude numeric,
      notes text
    );
    insert into public.dispatch_stops(status,latitude,longitude,notes)
      values('pending',null,null,'legacy-before-hardening');
  `);
  await db.exec(migration);
});

afterEach(async () => db?.close());

describe('planned stop coordinate hardening in PostgreSQL', () => {
  it.each([
    [null, null],
    [-23.5, null],
    [null, -46.6],
    [-91, -46.6],
    [91, -46.6],
    [-23.5, -181],
    [-23.5, 181],
  ])('rejects a newly planned stop with latitude %s and longitude %s', async (latitude, longitude) => {
    await expect(db.query(
      `insert into public.dispatch_stops(status,latitude,longitude) values('pending',$1,$2)`,
      [latitude, longitude],
    )).rejects.toThrow('planned_stop_coordinates_required');
    expect((await db.query<{ count: number }>(
      `select count(*)::int count from public.dispatch_stops where notes is null`,
    )).rows[0].count).toBe(0);
  });

  it('accepts the explicit coordinates used by planning and preserves them exactly', async () => {
    const inserted = await db.query<{ latitude: string; longitude: string }>(`
      insert into public.dispatch_stops(status,latitude,longitude,notes)
      values('pending',-23.55052,-46.633308,'manual-or-replanning')
      returning latitude::text,longitude::text
    `);
    expect(inserted.rows).toEqual([{ latitude: '-23.55052', longitude: '-46.633308' }]);
  });

  it('does not rewrite or block notes-only maintenance of a legacy stop', async () => {
    await db.exec(`update public.dispatch_stops set notes='legacy-reviewed' where notes='legacy-before-hardening'`);
    expect((await db.query(`select status,latitude,longitude,notes from public.dispatch_stops`)).rows)
      .toEqual([{ status: 'pending', latitude: null, longitude: null, notes: 'legacy-reviewed' }]);
  });

  it('allows a legacy arrival but refuses to advance it through another pre-arrival state', async () => {
    await expect(db.exec(`update public.dispatch_stops set status='arriving' where notes='legacy-before-hardening'`))
      .rejects.toThrow('planned_stop_coordinates_required');
    await db.exec('rollback');
    await db.exec(`update public.dispatch_stops set status='arrived' where notes='legacy-before-hardening'`);
    expect((await db.query<{ status: string }>(`select status from public.dispatch_stops where notes='legacy-before-hardening'`)).rows)
      .toEqual([{ status: 'arrived' }]);
  });

  it('keeps the trigger helper outside the browser RPC surface', async () => {
    const access = await db.query(`select
      has_function_privilege('anon','public.enforce_planned_stop_coordinates()','execute') anon,
      has_function_privilege('authenticated','public.enforce_planned_stop_coordinates()','execute') authenticated,
      has_function_privilege('service_role','public.enforce_planned_stop_coordinates()','execute') service_role`);
    expect(access.rows).toEqual([{ anon: false, authenticated: false, service_role: false }]);
  });
});
