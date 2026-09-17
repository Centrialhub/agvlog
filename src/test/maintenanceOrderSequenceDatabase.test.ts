// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917144100_backfill_maintenance_order_sequences.sql',
  'utf8',
);
const tenantYearMigration = readFileSync(
  'supabase/migrations/20260917144200_use_tenant_year_for_maintenance_orders.sql',
  'utf8',
);

const tenant = '21000000-0000-4000-8000-000000000001';
const aheadTenant = '21000000-0000-4000-8000-000000000002';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create schema finance_private;
    create role anon;
    create role authenticated;
    create role service_role;
    create table public.tenants(
      id uuid primary key,
      timezone text not null
    );
    create table public.maintenance_orders(
      id uuid primary key default gen_random_uuid(),
      tenant_id uuid not null,
      order_number text not null,
      unique(tenant_id,order_number)
    );
    create table finance_private.maintenance_order_sequences(
      tenant_id uuid primary key,
      next_number bigint not null default 1 check(next_number>0)
    );
    create function finance_private.next_maintenance_order_number(_tenant_id uuid)
    returns text language plpgsql security definer set search_path=''
    as $fn$
    declare value bigint;
    begin
      insert into finance_private.maintenance_order_sequences(tenant_id,next_number)
      values(_tenant_id,2)
      on conflict(tenant_id) do update
      set next_number=finance_private.maintenance_order_sequences.next_number+1
      returning next_number-1 into value;
      return 'OS-'||extract(year from current_date)::integer::text||'-'||lpad(value::text,6,'0');
    end
    $fn$;
    insert into public.maintenance_orders(tenant_id,order_number)
    values
      ('${tenant}','OS-2026-000001'),
      ('${tenant}','legado-sem-formato'),
      ('${aheadTenant}','OS-2026-000001');
    insert into finance_private.maintenance_order_sequences(tenant_id,next_number)
    values('${aheadTenant}',10);
    insert into public.tenants(id,timezone)
    values('${tenant}','America/Sao_Paulo'),('${aheadTenant}','Asia/Tokyo');
  `);
  await db.exec(migration);
  await db.exec(tenantYearMigration);
});

afterAll(async () => {
  await db?.close();
});

describe('maintenance order sequence backfill', () => {
  it('starts after the highest existing canonical number', async () => {
    const result = await db.query<{ number: string }>(
      'select finance_private.next_maintenance_order_number($1) number',
      [tenant],
    );
    expect(result.rows[0].number).toMatch(/^OS-\d{4}-000002$/);
  });

  it('never moves an existing sequence backwards and is idempotent', async () => {
    await db.exec(migration);
    const result = await db.query<{ number: string }>(
      'select finance_private.next_maintenance_order_number($1) number',
      [aheadTenant],
    );
    expect(result.rows[0].number).toMatch(/^OS-\d{4}-000010$/);
  });

  it('uses each tenant civil year at the UTC boundary', async () => {
    const result = await db.query<{ sao_paulo: number; tokyo: number }>(`
      select
        finance_private.maintenance_order_civil_year($1,'2027-01-01 01:30:00+00') sao_paulo,
        finance_private.maintenance_order_civil_year($2,'2026-12-31 15:30:00+00') tokyo
    `, [tenant, aheadTenant]);
    expect(result.rows[0]).toEqual({ sao_paulo: 2026, tokyo: 2027 });
  });
});
