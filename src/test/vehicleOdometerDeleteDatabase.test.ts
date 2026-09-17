// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917144300_serialize_odometer_deletes.sql',
  'utf8',
);
const tenant = '21000000-0000-4000-8000-000000000001';
const vehicle = '51000000-0000-4000-8000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.vehicles(
      id uuid primary key,
      tenant_id uuid not null,
      odometer_km numeric,
      updated_at timestamptz not null default now()
    );
    create table public.vehicle_odometer(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      vehicle_id uuid not null,
      reading_km numeric not null,
      recorded_at timestamptz not null
    );
    insert into public.vehicles(id,tenant_id) values('${vehicle}','${tenant}');
  `);
  await db.exec(migration);
});

afterAll(async () => {
  await db?.close();
});

describe('vehicle odometer delete synchronization', () => {
  it('projects the latest remaining reading after deleting the newest row', async () => {
    await db.query(`insert into public.vehicle_odometer(tenant_id,vehicle_id,reading_km,recorded_at)
      values($1,$2,100,'2026-01-01'),($1,$2,200,'2026-02-01')`, [tenant, vehicle]);
    expect((await db.query('select odometer_km from public.vehicles')).rows[0]).toEqual({ odometer_km: '200' });

    await db.query('delete from public.vehicle_odometer where reading_km=200');
    expect((await db.query('select odometer_km from public.vehicles')).rows[0]).toEqual({ odometer_km: '100' });
  });

  it('locks deletes in both the validator and synchronizer before recalculation', async () => {
    const trigger = await db.query<{ definition: string }>(`
      select pg_get_triggerdef(oid) definition from pg_trigger
      where tgname='validate_vehicle_odometer' and not tgisinternal
    `);
    expect(trigger.rows[0].definition).toContain('DELETE');

    const validator = await db.query<{ definition: string }>(`
      select pg_get_functiondef('public.tg_validate_vehicle_odometer()'::regprocedure) definition
    `);
    const synchronizer = await db.query<{ definition: string }>(`
      select pg_get_functiondef('public.tg_sync_vehicle_odometer()'::regprocedure) definition
    `);
    expect(validator.rows[0].definition).toMatch(/tg_op\s*=\s*'DELETE'/);
    expect(validator.rows[0].definition).toContain('pg_advisory_xact_lock');
    expect(synchronizer.rows[0].definition).toContain('pg_advisory_xact_lock');
    const syncDefinition = synchronizer.rows[0].definition.toLowerCase();
    expect(syncDefinition.indexOf('pg_advisory_xact_lock'))
      .toBeLessThan(syncDefinition.indexOf('update public.vehicles'));
  });
});
