// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260915224437_grant_fiscal_certificate_service_role.sql',
  'utf8',
);

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role bypassrls;
    create table public.fiscal_certificates (id uuid primary key default gen_random_uuid());
    create table public.tax_registry_queries (id uuid primary key default gen_random_uuid());
    create table public.fiscal_party_registry (id uuid primary key default gen_random_uuid());
  `);
  await db.exec(migration);
});

afterAll(async () => db?.close());

describe('fiscal certificate service boundary', () => {
  it.each([
    ['fiscal_certificates', true],
    ['tax_registry_queries', false],
    ['fiscal_party_registry', true],
  ])('grants the Edge Function its minimum access to %s', async (table, canUpdate) => {
    const result = await db.query<{
      service_select: boolean;
      service_insert: boolean;
      service_update: boolean;
      anon_access: boolean;
      authenticated_write: boolean;
    }>(`select
      has_table_privilege('service_role', $1, 'SELECT') service_select,
      has_table_privilege('service_role', $1, 'INSERT') service_insert,
      has_table_privilege('service_role', $1, 'UPDATE') service_update,
      has_table_privilege('anon', $1, 'SELECT,INSERT,UPDATE,DELETE') anon_access,
      has_table_privilege('authenticated', $1, 'INSERT,UPDATE,DELETE') authenticated_write`, [table]);

    expect(result.rows[0]).toEqual({
      service_select: true,
      service_insert: true,
      service_update: canUpdate,
      anon_access: false,
      authenticated_write: false,
    });
  });
});
