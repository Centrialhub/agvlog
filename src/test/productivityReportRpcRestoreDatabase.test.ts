// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260926191630_restore_productivity_report_reader.sql', 'utf8');
const tenant = '10000000-0000-4000-8000-000000000001';
const foreignTenant = '10000000-0000-4000-8000-000000000002';
const operator = '20000000-0000-4000-8000-000000000001';
const stranger = '20000000-0000-4000-8000-000000000002';
const driver = '30000000-0000-4000-8000-000000000001';
const vehicle = '40000000-0000-4000-8000-000000000001';
const client = '50000000-0000-4000-8000-000000000001';
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role;
    create schema auth;
    create function auth.uid() returns uuid language sql stable
      as $$select nullif(current_setting('request.jwt.claim.sub',true),'')::uuid$$;
    create table public.operator_memberships(tenant_id uuid,user_id uuid);
    create function public.is_tenant_operator_or_admin(t uuid) returns boolean
      language sql stable as $$select exists(select 1 from public.operator_memberships
        where tenant_id=t and user_id=auth.uid())$$;
    create table public.tenants(id uuid primary key,timezone text);
    create table public.drivers(id uuid primary key,tenant_id uuid,name text);
    create table public.vehicles(id uuid primary key,tenant_id uuid,plate text,nickname text,max_pallets integer);
    create table public.clients(id uuid primary key,tenant_id uuid,company_name text);
    create table public.loads(id uuid primary key,tenant_id uuid,driver_id uuid,vehicle_id uuid,
      created_at timestamptz,status text,total_pallet_count integer,trip_id uuid);
    create table public.operational_events(id uuid primary key,tenant_id uuid,driver_id uuid,
      vehicle_id uuid,client_id uuid,created_at timestamptz,financial_impact numeric);
    insert into public.operator_memberships values ('${tenant}','${operator}');
    insert into public.tenants values
      ('${tenant}','America/Sao_Paulo'),('${foreignTenant}','America/Sao_Paulo');
    insert into public.drivers values ('${driver}','${tenant}','Condutor A');
    insert into public.vehicles values ('${vehicle}','${tenant}','ABC1234','V1',20);
    insert into public.clients values ('${client}','${tenant}','Cliente A');
    insert into public.loads values
      ('60000000-0000-4000-8000-000000000001','${tenant}','${driver}','${vehicle}',
        '2026-09-26T02:00:00Z','delivered',10,'70000000-0000-4000-8000-000000000001'),
      ('60000000-0000-4000-8000-000000000002','${foreignTenant}',null,null,
        '2026-09-26T02:00:00Z','delivered',30,null);
    insert into public.operational_events values
      ('80000000-0000-4000-8000-000000000001','${tenant}','${driver}','${vehicle}','${client}',
        '2026-09-26T02:00:00Z',125),
      ('80000000-0000-4000-8000-000000000002','${foreignTenant}',null,null,null,
        '2026-09-26T02:00:00Z',999);
  `);
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
  await db.exec(migration);
}, 20_000);
afterAll(async () => { await db?.close(); });

describe('published productivity summary', () => {
  it('grants only authenticated execution and leaves an existing body unchanged', async () => {
    const signature = 'public.productivity_report_summary_v1(uuid,uuid,uuid,date,date)';
    const before = (await db.query<{ body: string; definer: boolean; auth: boolean; service: boolean; anon: boolean }>(`
      select prosrc body,prosecdef definer,
        has_function_privilege('authenticated',$1,'execute') auth,
        has_function_privilege('service_role',$1,'execute') service,
        has_function_privilege('anon',$1,'execute') anon
      from pg_proc where oid=to_regprocedure($1)`, [signature])).rows[0];
    expect(before).toMatchObject({ definer: true, auth: true, service: false, anon: false });
    await db.exec(migration);
    const after = (await db.query<{ body: string }>(
      'select prosrc body from pg_proc where oid=to_regprocedure($1)', [signature])).rows[0];
    expect(after.body).toBe(before.body);
  });

  it('uses tenant civil dates and excludes another tenant', async () => {
    const result = (await db.query<{ payload: Record<string, unknown> }>(
      'select public.productivity_report_summary_v1($1,null,null,$2,$2) payload',
      [tenant, '2026-09-25'])).rows[0].payload;
    expect(result).toMatchObject({
      version: 1, tenant_id: tenant, timezone: 'America/Sao_Paulo',
      total_loads: 1, total_events: 1, total_delivered: 1,
      total_financial_impact: 125, avg_pallets_per_trip: 10,
    });
    expect(result.driver_metrics).toEqual([expect.objectContaining({
      id: driver, loads: 1, deliveries: 1, avg_pallets: 10,
    })]);
    expect(result.client_divergences).toEqual([expect.objectContaining({
      id: client, total: 1, impact: 125,
    })]);
    const nextDay = (await db.query<{ payload: { total_loads: number; total_events: number } }>(
      'select public.productivity_report_summary_v1($1,null,null,$2,$2) payload',
      [tenant, '2026-09-26'])).rows[0].payload;
    expect(nextDay).toMatchObject({ total_loads: 0, total_events: 0 });
  });

  it('rejects foreign tenant access and inverted date ranges', async () => {
    await expect(db.query('select public.productivity_report_summary_v1($1)',
      [foreignTenant])).rejects.toThrow('operator_required');
    await expect(db.query('select public.productivity_report_summary_v1($1,null,null,$2,$3)',
      [tenant, '2026-09-26', '2026-09-25'])).rejects.toThrow('invalid_productivity_period');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [stranger]);
    try {
      await expect(db.query('select public.productivity_report_summary_v1($1)',
        [tenant])).rejects.toThrow('operator_required');
    } finally {
      await db.query("select set_config('request.jwt.claim.sub',$1,false)", [operator]);
    }
  });
});
