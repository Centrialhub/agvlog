// @vitest-environment node
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260902021339_retire_unbounded_reimport_cleanup_browser_acl.sql',
), 'utf8');
const baseline = readFileSync(join(
  process.cwd(),
  'supabase/migrations/20260824224152_baseline.sql',
), 'utf8');
const reimportDialog = readFileSync(join(
  process.cwd(),
  'src/components/loads/BatchReimportDialog.tsx',
), 'utf8');

const target = 'clear_reimport_batch_data(uuid)';
const bounded = 'clear_reimport_batch_data(uuid,date,date)';
const preview = 'preview_reimport_cleanup_counts(uuid,date,date)';

const functionDefinition = (declaration: string) => {
  const start = baseline.indexOf(declaration);
  if (start < 0) throw new Error(`Baseline definition not found: ${declaration}`);
  const end = baseline.indexOf('$function$;', start);
  if (end < 0) throw new Error(`Baseline definition is incomplete: ${declaration}`);
  return baseline.slice(start, end + '$function$;'.length).replace(/\r\n/g, '\n');
};

const definitions = [
  functionDefinition('CREATE OR REPLACE FUNCTION public.clear_reimport_batch_data(_tenant_id uuid)'),
  functionDefinition('CREATE OR REPLACE FUNCTION public.preview_reimport_cleanup_counts('),
  functionDefinition('CREATE OR REPLACE FUNCTION public.clear_reimport_batch_data(_tenant_id uuid, _start_date date'),
];

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists public;
  `);
});

beforeEach(async () => {
  await db.exec(definitions.join('\n'));
  await db.exec(`
    revoke all on function public.${target}, public.${bounded}, public.${preview}
      from public, anon, authenticated, service_role;
    grant execute on function public.${target}, public.${bounded}, public.${preview}
      to authenticated, service_role;
  `);
});

afterAll(async () => {
  await db.close();
});

describe('unbounded reimport cleanup browser ACL closure', () => {
  it('revokes only the unbounded overload and preserves service/bounded access', async () => {
    await db.exec(migration);
    const result = await db.query<{
      target_anon: boolean;
      target_authenticated: boolean;
      target_service: boolean;
      bounded_authenticated: boolean;
      preview_authenticated: boolean;
    }>(`
      select
        has_function_privilege('anon','public.${target}','execute') target_anon,
        has_function_privilege('authenticated','public.${target}','execute') target_authenticated,
        has_function_privilege('service_role','public.${target}','execute') target_service,
        has_function_privilege('authenticated','public.${bounded}','execute') bounded_authenticated,
        has_function_privilege('authenticated','public.${preview}','execute') preview_authenticated
    `);
    expect(result.rows[0]).toEqual({
      target_anon: false,
      target_authenticated: false,
      target_service: true,
      bounded_authenticated: true,
      preview_authenticated: true,
    });
  });

  it('fails before revocation when the target body drifts', async () => {
    await db.exec(`
      create or replace function public.clear_reimport_batch_data(_tenant_id uuid)
      returns jsonb language plpgsql security definer set search_path=public
      as $$begin return '{}'::jsonb; end$$
    `);
    await expect(db.exec(migration)).rejects.toThrow(
      'Unbounded reimport cleanup changed before ACL closure',
    );
    const result = await db.query<{ allowed: boolean }>(`
      select has_function_privilege(
        'authenticated','public.${target}','execute'
      ) allowed
    `);
    expect(result.rows[0].allowed).toBe(true);
  });

  it('fails before revocation when the bounded replacement drifts', async () => {
    await db.exec(`
      create or replace function public.clear_reimport_batch_data(
        _tenant_id uuid, _start_date date default null, _end_date date default null
      ) returns jsonb language plpgsql security definer set search_path=public
      as $$begin return '{}'::jsonb; end$$
    `);
    await expect(db.exec(migration)).rejects.toThrow(
      'Bounded reimport cleanup contract changed before cutover',
    );
    const result = await db.query<{ allowed: boolean }>(`
      select has_function_privilege(
        'authenticated','public.${target}','execute'
      ) allowed
    `);
    expect(result.rows[0].allowed).toBe(true);
  });

  it('fails before revocation when a SQL caller appears', async () => {
    await db.exec(`
      create function public.unexpected_cleanup_caller(_tenant_id uuid)
      returns jsonb language plpgsql security definer set search_path=public
      as $$
      declare result jsonb;
      begin
        execute 'select public.clear_reimport_batch_data($1)'
          using _tenant_id into result;
        return result;
      end
      $$
    `);
    await expect(db.exec(migration)).rejects.toThrow(
      'Unbounded reimport cleanup gained a database caller',
    );
    const result = await db.query<{ allowed: boolean }>(`
      select has_function_privilege(
        'authenticated','public.${target}','execute'
      ) allowed
    `);
    expect(result.rows[0].allowed).toBe(true);
  });

  it('keeps the frontend on the previewed, date-bounded contract', () => {
    const call = reimportDialog.match(
      /\.rpc\('clear_reimport_batch_data',[\s\S]*?\}\);/,
    )?.[0];
    expect(call).toBeDefined();
    expect(call).toContain('_tenant_id:');
    expect(call).toContain('_start_date:');
    expect(call).toContain('_end_date:');
    expect(reimportDialog).toMatch(
      /\.rpc\('preview_reimport_cleanup_counts',[\s\S]*?_start_date:[\s\S]*?_end_date:/,
    );
  });

  it('is explicit and cannot become a broad ACL sweep', () => {
    expect(migration).toContain('8d0b04f70eb6f935e4faff7f871242b8');
    expect(migration).toContain('1e0fc420e4d27711f296c4031e33307e');
    expect(migration).toContain('46c3bf0e7b28d3bcf75c4711ae24b187');
    expect(migration).not.toMatch(
      /all functions in schema|alter default privileges|for\s+routine\s+in/i,
    );
    expect(migration).not.toMatch(
      /revoke[^;]+clear_reimport_batch_data\(uuid,date,date\)/i,
    );
  });
});
