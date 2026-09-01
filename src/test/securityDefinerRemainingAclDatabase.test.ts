// @vitest-environment node
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migrationPath = join(
  process.cwd(),
  'supabase/migrations/20260901003429_close_remaining_legacy_security_definer_acl.sql',
);
const migration = readFileSync(migrationPath, 'utf8');

const legacy = [
  'add_driver_settlement_adjustment(uuid,text,numeric,text,text)',
  'remove_driver_settlement_adjustment(uuid,uuid,text)',
  'add_driver_settlement_manual_expense(uuid,text,numeric,timestamptz,text,text,boolean,text,text)',
  'driver_create_expense(uuid,text,numeric,text,text,timestamptz,text,text,text,text,numeric,boolean,text,boolean,text,boolean)',
  'create_client_invoice(jsonb)',
  'generate_client_invoice_from_closing(uuid)',
  'cancel_client_invoice(uuid,text)',
  'next_closing_report_number(uuid,date)',
  'close_closing_report(uuid)',
  'cancel_closing_report(uuid,text)',
  'reopen_closing_report(uuid,text)',
  'register_closing_report_payment(uuid,jsonb)',
  'register_receivable_payment(uuid,numeric,timestamptz,uuid,text,text,text)',
  'reverse_receivable_payment(uuid)',
] as const;

const canonical = [
  'apply_driver_settlement_adjustment(jsonb)',
  'create_driver_expense_command(jsonb)',
  'apply_client_invoice_command(jsonb)',
  'create_closing_report_draft(jsonb)',
  'apply_closing_report_action(jsonb)',
  'apply_receivable_financial_command(jsonb)',
] as const;

const runtimeFiles = (root: string): string[] => readdirSync(root).flatMap((entry) => {
  const path = join(root, entry);
  if (path.includes(join('src', 'test')) || path.includes(join('src', 'integrations', 'supabase', 'types.ts'))) return [];
  if (statSync(path).isDirectory()) return runtimeFiles(path);
  return /\.(ts|tsx)$/.test(path) ? [path] : [];
});

const runtimeSource = [join(process.cwd(), 'src'), join(process.cwd(), 'supabase/functions')]
  .flatMap(runtimeFiles)
  .map((path) => readFileSync(path, 'utf8'))
  .join('\n');

let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon;
    create role authenticated;
    create role service_role;
    create schema if not exists public;
  `);

  for (const signature of [...legacy, ...canonical]) {
    const open = signature.indexOf('(');
    const name = signature.slice(0, open);
    const types = signature.slice(open + 1, -1);
    const args = types.length === 0
      ? ''
      : types.split(',').map((type, index) => `p${index} ${type}`).join(',');
    await db.exec(`
      create function public.${name}(${args}) returns integer
      language sql security definer set search_path='' as $$select 1$$;
      revoke all on function public.${signature} from public, anon, authenticated, service_role;
      grant execute on function public.${signature} to authenticated, service_role;
    `);
  }
}, 30_000);

afterAll(async () => {
  await db?.close();
});

describe('remaining SECURITY DEFINER browser ACL closure', () => {
  it('fails closed before any revocation when a canonical RPC is unavailable', async () => {
    await db.exec('begin');
    try {
      await db.exec('drop function public.apply_client_invoice_command(jsonb)');
      await db.exec('savepoint before_acl_migration');
      await expect(db.exec(migration)).rejects.toThrow('Canonical authenticated RPC is not ready');
      await db.exec('rollback to savepoint before_acl_migration');
      const result = await db.query<{ allowed: boolean }>(`
        select has_function_privilege(
          'authenticated',
          'public.create_client_invoice(jsonb)',
          'EXECUTE'
        ) allowed
      `);
      expect(result.rows[0].allowed).toBe(true);
    } finally {
      await db.exec('rollback');
    }
  });

  it('removes only browser execution and preserves service and canonical access', async () => {
    await db.exec('begin');
    try {
      await db.exec(migration);
      for (const signature of legacy) {
        const result = await db.query<{ anon: boolean; authenticated: boolean; service: boolean }>(`
          select
            has_function_privilege('anon', 'public.${signature}', 'EXECUTE') anon,
            has_function_privilege('authenticated', 'public.${signature}', 'EXECUTE') authenticated,
            has_function_privilege('service_role', 'public.${signature}', 'EXECUTE') service
        `);
        expect(result.rows[0], signature).toEqual({ anon: false, authenticated: false, service: true });
      }
      for (const signature of canonical) {
        const result = await db.query<{ authenticated: boolean }>(`
          select has_function_privilege('authenticated', 'public.${signature}', 'EXECUTE') authenticated
        `);
        expect(result.rows[0].authenticated, signature).toBe(true);
      }
    } finally {
      await db.exec('rollback');
    }
  });

  it('uses an explicit 14-signature allowlist and leaves current/RLS APIs untouched', () => {
    expect(legacy).toHaveLength(14);
    expect(migration).not.toMatch(/all functions in schema|for\s+routine\s+in|alter default privileges/i);
    for (const signature of legacy) expect(migration).toContain(`public.${signature}`);
    const revokedTargets = [...migration.matchAll(
      /revoke all privileges on function([\s\S]*?)from public, anon, authenticated;/gi,
    )].map((match) => match[1]).join('\n');
    for (const signature of canonical) expect(revokedTargets).not.toContain('public.' + signature);
    for (const helper of [
      'private._driver_load_ids',
      'private.driver_owns_stop',
      'public.driver_owns_trip',
      'public.portal_user_can_access_fiscal_document',
      'public.has_tenant_role',
    ]) expect(migration).not.toContain(helper);
  });

  it('has no direct runtime RPC call to a revoked legacy implementation', () => {
    for (const signature of legacy) {
      const name = signature.slice(0, signature.indexOf('('));
      expect(runtimeSource, name).not.toMatch(
        new RegExp(`\\.rpc\\s*\\(\\s*['"]${name}['"]`),
      );
    }
  });
});
