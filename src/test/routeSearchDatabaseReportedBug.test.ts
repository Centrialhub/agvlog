// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

let db: PGlite;
const tenant = '00000000-0000-4000-8000-000000000001';

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create table geofences(id uuid primary key, tenant_id uuid not null, name text not null);
    create table route_templates(
      id uuid primary key, tenant_id uuid not null, name text not null, enabled boolean not null,
      corridor_geofence_id uuid, created_at timestamptz not null default now()
    );
    create table route_waypoints(
      id uuid primary key, tenant_id uuid not null, route_id uuid not null, label text not null
    );
  `);
  await db.exec(readFileSync('supabase/migrations/20260921180114_search_route_templates_page.sql', 'utf8'));
  await db.query('insert into geofences values ($1,$2,$3)', ['00000000-0000-4000-8000-000000000010', tenant, 'Cerca Norte']);
  await db.query('insert into route_templates(id,tenant_id,name,enabled,corridor_geofence_id) values ($1,$2,$3,true,$4),($5,$2,$6,true,null)', [
    '00000000-0000-4000-8000-000000000020', tenant, 'Corredor A', '00000000-0000-4000-8000-000000000010',
    '00000000-0000-4000-8000-000000000021', 'Corredor B',
  ]);
  await db.query('insert into route_waypoints values ($1,$2,$3,$4)', ['00000000-0000-4000-8000-000000000030', tenant, '00000000-0000-4000-8000-000000000021', 'Depósito Central']);
}, 30_000);

afterAll(async () => db.close());

describe('route search database reader', () => {
  it.each([['Cerca Norte', 'Corredor A'], ['Depósito Central', 'Corredor B']])('finds %s through related labels', async (search, expected) => {
    const result = await db.query<{ payload: { rows: Array<{ name: string }>; total: number } }>(
      'select list_operator_routes_page_v1($1,$2) payload', [tenant, search],
    );
    expect(result.rows[0].payload.total).toBe(1);
    expect(result.rows[0].payload.rows[0].name).toBe(expected);
  });
});
