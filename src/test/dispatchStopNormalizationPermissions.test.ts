// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const tenantA = '10000000-0000-4000-8000-000000000001';
const tenantB = '10000000-0000-4000-8000-000000000002';
const clientA = '20000000-0000-4000-8000-000000000001';
const clientB = '20000000-0000-4000-8000-000000000002';
const historical = readFileSync('supabase/migrations/20260910192455_complete_address_geocoding_automation.sql', 'utf8');
function historicalFunction(pattern: RegExp) {
  const definition = historical.match(pattern)?.[0];
  if (!definition) throw new Error('historical_geocode_function_missing');
  return definition;
}
const normalizer = historicalFunction(/create or replace function private\.normalized_address_text\(_address text\)[\s\S]*?\$function\$;/);
const trigger = historicalFunction(/create or replace function private\.apply_verified_client_geocode_to_stop\(\)[\s\S]*?\$function\$;/);
const forward = readFileSync('supabase/migrations/20261014062118_native_dispatch_stop_helper_execute.sql', 'utf8');
let db: PGlite;

async function asRole<T>(role: 'authenticated' | 'anon' | 'service_role', action: () => Promise<T>, tenant = tenantA): Promise<T> {
  await db.exec(`set role ${role}`);
  await db.query("select set_config('test.tenant_id', $1, false)", [tenant]);
  try { return await action(); }
  finally { await db.exec('reset role'); }
}

async function insertStop(client = clientA, tenant = tenantA) {
  return db.query<{
    id: string; latitude: number | null; longitude: number | null;
    location_source: string | null; location_verification_status: string;
    source_client_address_hash: string | null;
  }>(`insert into public.dispatch_stops(id, tenant_id, client_id, destination, location_address)
    values ($1, $2, $3, '  RUA   NATIVE  123  ', '  RUA   NATIVE  123  ')
    returning id, latitude, longitude, location_source, location_verification_status, source_client_address_hash`,
  [randomUUID(), tenant, client]);
}

async function definitionSnapshot() {
  return (await db.query(`select p.oid::text, n.nspname, p.proname, p.proowner::text,
    p.prosecdef, p.provolatile, p.prolang::text, p.proconfig, md5(p.prosrc) body_md5
    from pg_proc p join pg_namespace n on n.oid=p.pronamespace
    where n.nspname='private' order by p.proname`)).rows;
}

async function policySnapshot() {
  return (await db.query(`select schemaname, tablename, policyname, roles, cmd, qual, with_check
    from pg_policies where schemaname='public' order by tablename, policyname`)).rows;
}

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`create role anon; create role authenticated; create role service_role;
    create schema private;
    grant usage on schema private to authenticated, service_role;
    create table public.clients(id uuid primary key, tenant_id uuid, address_geocode_status text,
      address_lat double precision, address_lng double precision, address_geocode_hash text,
      address_geocode_provider text, address_geocode_accuracy_m double precision,
      address_geocode_confidence double precision, address_geocoded_at timestamptz, address_geocoded_by uuid);
    create table public.dispatch_stops(id uuid primary key, tenant_id uuid not null, client_id uuid,
      destination text, location_address text, latitude double precision, longitude double precision,
      location_source text, location_verification_status text, source_client_address_hash text,
      location_provider text, location_accuracy_m double precision, location_confidence double precision,
      location_resolved_at timestamptz, location_resolved_by uuid, location_invalidated_at timestamptz,
      location_exception_reason text, location_audit jsonb);
    alter table public.clients enable row level security;
    alter table public.dispatch_stops enable row level security;
    create policy clients_tenant_select on public.clients for select to authenticated
      using(tenant_id=nullif(current_setting('test.tenant_id', true), '')::uuid);
    create policy stops_tenant_write on public.dispatch_stops for all to authenticated
      using(tenant_id=nullif(current_setting('test.tenant_id', true), '')::uuid)
      with check(tenant_id=nullif(current_setting('test.tenant_id', true), '')::uuid);
    grant select on public.clients to authenticated;
    grant select, insert, update on public.dispatch_stops to authenticated;
    ${normalizer}
    revoke all on function private.normalized_address_text(text) from public, anon, authenticated, service_role;
    ${trigger}
    revoke all on function private.apply_verified_client_geocode_to_stop() from public, anon, authenticated, service_role;
    create trigger apply_verified_client_geocode_to_stop before insert or update of client_id, destination, latitude,
      longitude, location_source, location_address on public.dispatch_stops
      for each row execute function private.apply_verified_client_geocode_to_stop();
    insert into public.clients(id, tenant_id, address_geocode_status, address_lat, address_lng,
      address_geocode_hash, address_geocode_provider) values
      ('${clientA}', '${tenantA}', 'verified', -19.91, -43.91,
        encode(sha256(convert_to(private.normalized_address_text('Rua Native 123'), 'UTF8')), 'hex'), 'synthetic'),
      ('${clientB}', '${tenantB}', 'verified', 1.23, 4.56,
        encode(sha256(convert_to(private.normalized_address_text('Rua Native 123'), 'UTF8')), 'hex'), 'synthetic');`);
}, 15000);

afterAll(async () => { await db?.close(); });

describe('authenticated invoker dispatch-stop normalization', () => {
  it('reproduces the original nested helper permission failure without committing a stop', async () => {
    await expect(asRole('authenticated', () => insertStop())).rejects.toThrow('permission denied for function normalized_address_text');
    expect((await db.query('select count(*)::int n from public.dispatch_stops')).rows).toEqual([{ n: 0 }]);
  });

  it('grants only the known helper and preserves every function definition and RLS policy', async () => {
    const functions = await definitionSnapshot();
    const policies = await policySnapshot();
    await db.exec(forward);
    expect(await definitionSnapshot()).toEqual(functions);
    expect(await policySnapshot()).toEqual(policies);
    expect((await db.query(`select
      has_function_privilege('authenticated', 'private.normalized_address_text(text)', 'EXECUTE') helper,
      has_function_privilege('authenticated', 'private.apply_verified_client_geocode_to_stop()', 'EXECUTE') trigger,
      has_function_privilege('anon', 'private.normalized_address_text(text)', 'EXECUTE') anon,
      has_function_privilege('service_role', 'private.normalized_address_text(text)', 'EXECUTE') service,
      has_function_privilege('authenticated', 'private.normalized_address_text(text)', 'EXECUTE WITH GRANT OPTION') delegate`)).rows)
      .toEqual([{ helper: true, trigger: false, anon: false, service: false, delegate: false }]);
  });

  it('normalizes only caller-provided text, including null and whitespace', async () => {
    const rows = await asRole('authenticated', () => db.query(`select
      private.normalized_address_text(null) empty,
      private.normalized_address_text(E'  RUA\\t NATIVE\\n123  ') address`));
    expect(rows.rows).toEqual([{ empty: '', address: 'rua native 123' }]);
  });

  it('persists a stop with coordinates from an RLS-visible verified client', async () => {
    const result = await asRole('authenticated', () => insertStop());
    expect(result.rows[0]).toMatchObject({ latitude: -19.91, longitude: -43.91,
      location_source: 'address_geocoded', location_verification_status: 'verified' });
    expect(result.rows[0].source_client_address_hash).toHaveLength(64);
    expect((await db.query('select location_address from public.dispatch_stops where id=$1', [result.rows[0].id])).rows)
      .toEqual([{ location_address: 'rua native 123' }]);
  });

  it('also persists the authenticated update path through the original trigger', async () => {
    const id = randomUUID();
    await asRole('authenticated', () => db.query(`insert into public.dispatch_stops(id, tenant_id, destination)
      values($1, $2, 'Rua Native 123')`, [id, tenantA]));
    const result = await asRole('authenticated', () => db.query(`update public.dispatch_stops set client_id=$2
      where id=$1 returning latitude, longitude, location_verification_status`, [id, clientA]));
    expect(result.rows).toEqual([{ latitude: -19.91, longitude: -43.91, location_verification_status: 'verified' }]);
  });

  it('keeps foreign client rows invisible and refuses writes to a foreign tenant', async () => {
    const foreignClient = await asRole('authenticated', () => insertStop(clientB));
    expect(foreignClient.rows[0]).toMatchObject({ latitude: null, longitude: null,
      location_verification_status: 'pending', source_client_address_hash: null });
    const count = (await db.query('select count(*)::int n from public.dispatch_stops')).rows;
    await expect(asRole('authenticated', () => insertStop(clientB, tenantB))).rejects.toThrow('row-level security');
    expect((await db.query('select count(*)::int n from public.dispatch_stops')).rows).toEqual(count);
    expect((await asRole('authenticated', () => db.query('select id from public.clients where tenant_id=$1', [tenantB]))).rows)
      .toEqual([]);
  });

  it('does not authorize anonymous or service callers to execute the private helper', async () => {
    for (const role of ['anon', 'service_role'] as const) {
      await expect(asRole(role, () => db.query("select private.normalized_address_text('Rua Native 123')")))
        .rejects.toThrow('permission denied');
    }
  });

  it('is idempotent and the specific revoke restores the known permission boundary', async () => {
    const acl = (await db.query("select proacl::text acl from pg_proc where oid='private.normalized_address_text(text)'::regprocedure")).rows;
    await db.exec(forward);
    expect((await db.query("select proacl::text acl from pg_proc where oid='private.normalized_address_text(text)'::regprocedure")).rows).toEqual(acl);
    await db.exec('revoke execute on function private.normalized_address_text(text) from authenticated');
    try {
      await expect(asRole('authenticated', () => insertStop())).rejects.toThrow('permission denied for function normalized_address_text');
    } finally { await db.exec(forward); }
  });

  it('rejects a changed body before granting it, then restores the known synthetic definition', async () => {
    await db.exec(`revoke execute on function private.normalized_address_text(text) from authenticated;
      create or replace function private.normalized_address_text(_address text)
      returns text language sql immutable set search_path='' as $$select current_user::text||coalesce(_address, '')$$;`);
    try {
      await expect(db.exec(forward)).rejects.toThrow('dispatch_stop_normalizer_definition_mismatch');
      expect((await db.query(`select has_function_privilege('authenticated',
        'private.normalized_address_text(text)', 'EXECUTE') allowed`)).rows).toEqual([{ allowed: false }]);
    } finally {
      await db.exec(normalizer);
      await db.exec(forward);
    }
  });
});
