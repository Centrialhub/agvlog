// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const backendOnlyTables = [
  'application_error_events',
  'application_web_vitals',
  'secure_upload_rate_events',
] as const;

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    set check_function_bodies = false;
    create role anon;
    create role authenticated;
    create role service_role;
    create schema cron;
    create table cron.job(jobid bigint generated always as identity, jobname text);
    create function cron.unschedule(bigint) returns boolean
      language sql as $$select true$$;
    create function cron.schedule(text, text, text) returns bigint
      language sql as $$select 1::bigint$$;
    create function public.create_tenant_with_owner(text) returns uuid
      language sql
      security definer
      set search_path = ''
      as $$select gen_random_uuid()$$;
    revoke all on function public.create_tenant_with_owner(text)
      from public, anon, authenticated, service_role;
  `);

  for (const migration of [
    '20260829143948_add_production_application_error_telemetry.sql',
    '20260829143955_add_production_application_web_vitals.sql',
    '20260829144001_add_production_secure_upload_rate_limits.sql',
  ]) {
    await db.exec(readFileSync(`supabase/migrations/${migration}`, 'utf8'));
  }
}, 30_000);

afterAll(async () => db?.close());

describe('backend-only RLS tables in PostgreSQL', () => {
  it.each(backendOnlyTables)(
    'keeps %s closed to browser roles while RLS has no permissive policy',
    async (table) => {
      const row = (
        await db.query<{
          rls_enabled: boolean;
          policy_count: number;
          anon_dml: boolean;
          authenticated_dml: boolean;
          service_select: boolean;
          service_insert: boolean;
          service_delete: boolean;
          service_update: boolean;
        }>(`select
          c.relrowsecurity rls_enabled,
          (select count(*)::integer from pg_policy where polrelid = c.oid) policy_count,
          has_table_privilege('anon', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') anon_dml,
          has_table_privilege('authenticated', c.oid, 'SELECT,INSERT,UPDATE,DELETE,TRUNCATE') authenticated_dml,
          has_table_privilege('service_role', c.oid, 'SELECT') service_select,
          has_table_privilege('service_role', c.oid, 'INSERT') service_insert,
          has_table_privilege('service_role', c.oid, 'DELETE') service_delete,
          has_table_privilege('service_role', c.oid, 'UPDATE') service_update
        from pg_class c
        join pg_namespace n on n.oid = c.relnamespace
        where n.nspname = 'public' and c.relname = $1`, [table])
      ).rows[0];

      expect(row).toEqual({
        rls_enabled: true,
        policy_count: 0,
        anon_dml: false,
        authenticated_dml: false,
        service_select: true,
        service_insert: true,
        service_delete: true,
        service_update: false,
      });
    },
  );

  it.each([
    'purge_application_error_events_v1()',
    'consume_secure_upload_quota_v1(text,text,integer,integer)',
    'purge_secure_upload_rate_events_v1()',
  ])('keeps backend helper %s off the browser API', async (signature) => {
    const row = (
      await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(
        `select
          has_function_privilege('anon', $1, 'EXECUTE') anon,
          has_function_privilege('authenticated', $1, 'EXECUTE') authenticated,
          has_function_privilege('service_role', $1, 'EXECUTE') service`,
        [`public.${signature}`],
      )
    ).rows[0];

    expect(row).toEqual({ anon: false, authenticated: false, service: true });
  });

  it('executes the read-only catalog verifier against the integrated fixture', async () => {
    await expect(
      db.exec(
        readFileSync(
          'supabase/verify/security_boundary_inventory.sql',
          'utf8',
        ),
      ),
    ).resolves.toBeDefined();
  });
});
