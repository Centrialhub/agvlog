// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createDocumentChangeDatabase,
  documentChangeIds as i,
  seedDocumentChanges,
} from './helpers/documentChangesDatabase';
import { compositionRpc } from './helpers/compositionDatabase';

let db: PGlite;
const migration = readFileSync(
  'supabase/migrations/20260916024238_harden_fiscal_document_composition_rpcs.sql',
  'utf8',
);
const preflight = migration.match(/do \$preflight\$[\s\S]*?\$preflight\$;/)?.[0];
if (!preflight) throw new Error('Missing fiscal composition preflight');

beforeAll(async () => {
  db = await createDocumentChangeDatabase();
  // This focused fixture intentionally has the older pre-delivery-attempt
  // composition helper. The production preflight must refuse that baseline.
  await expect(db.exec(preflight)).rejects.toThrow(/fiscal_document_composition_contract_changed/);
  await db.exec(migration.replace(preflight, ''));
}, 30000);

beforeEach(async () => {
  await seedDocumentChanges(db);
});

afterAll(async () => {
  await db?.close();
});

describe('fiscal document composition authorization boundary', () => {
  it('pins the complete live dependency and wrapper contract before replacing ACLs', () => {
    expect(migration).toContain("'public._change_load_documents(uuid,uuid,uuid[],text,jsonb,text,text)', '8821275d0393e6b3599e84aceefd663b'");
    expect(migration).toContain("'public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])', '73793256599bf96b8232ddc15a68d166'");
    expect(migration).toContain("'public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])', '6ee516b30bc6d8fb5acdfd3a7820c9a4'");
    expect(migration).toContain("'public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])', '151cc5f78065f8cbce15464d9d088933'");
    expect(migration).toContain("'public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])', 'c2220961533993d755e6cae225c402ca'");
    expect(migration).toContain("'public.is_tenant_operator_or_admin(uuid)', '682f66029dc9bb798f9f329b4e8f95aa'");
    expect(migration).toContain('fiscal_document_composition_acl_changed');
  });

  it('keeps the v2 compatibility RPC available to an active tenant operator', async () => {
    const result = await compositionRpc(
      db,
      'select public.assign_fiscal_documents_to_load_v2($1,$2,$3) result',
      [i.tenant, i.load, [i.doc3]],
    );
    expect(result.rows[0]).toMatchObject({ result: { added: 1, updated: 1 } });
    const definition = await db.query<{ definition: string }>(
      "select pg_get_functiondef('public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])'::regprocedure) definition",
    );
    expect(definition.rows[0].definition).toContain('Inclusão pela operação');
  });

  it.each([
    'assign_fiscal_documents_to_load_v2',
    'remove_fiscal_documents_from_load_v2',
  ])('rejects %s before a user can address another tenant graph', async (name) => {
    await expect(compositionRpc(
      db,
      `select public.${name}($1,$2,$3)`,
      [i.otherTenant, i.load, [i.doc3]],
    )).rejects.toThrow(/not_authorized/);
  });

  it.each([
    'assign_fiscal_documents_to_load',
    'remove_fiscal_documents_from_load',
  ])('removes authenticated execution from legacy %s', async (name) => {
    await expect(compositionRpc(
      db,
      `select public.${name}($1,$2,$3)`,
      [i.tenant, i.load, [i.doc3]],
    )).rejects.toThrow(/permission denied/);
  });

  it('enforces the exact browser/service ACL split', async () => {
    const privileges = await db.query<{
      auth_assign_v1: boolean;
      service_assign_v1: boolean;
      auth_assign_v2: boolean;
      service_assign_v2: boolean;
      anon_assign_v2: boolean;
      auth_remove_v1: boolean;
      service_remove_v1: boolean;
      auth_remove_v2: boolean;
      service_remove_v2: boolean;
      anon_remove_v2: boolean;
    }>(`
      select
        has_function_privilege('authenticated','public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])','execute') auth_assign_v1,
        has_function_privilege('service_role','public.assign_fiscal_documents_to_load(uuid,uuid,uuid[])','execute') service_assign_v1,
        has_function_privilege('authenticated','public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','execute') auth_assign_v2,
        has_function_privilege('service_role','public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','execute') service_assign_v2,
        has_function_privilege('anon','public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])','execute') anon_assign_v2,
        has_function_privilege('authenticated','public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])','execute') auth_remove_v1,
        has_function_privilege('service_role','public.remove_fiscal_documents_from_load(uuid,uuid,uuid[])','execute') service_remove_v1,
        has_function_privilege('authenticated','public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','execute') auth_remove_v2,
        has_function_privilege('service_role','public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','execute') service_remove_v2,
        has_function_privilege('anon','public.remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])','execute') anon_remove_v2
    `);
    expect(privileges.rows[0]).toEqual({
      auth_assign_v1: false,
      service_assign_v1: false,
      auth_assign_v2: true,
      service_assign_v2: false,
      anon_assign_v2: false,
      auth_remove_v1: false,
      service_remove_v1: false,
      auth_remove_v2: true,
      service_remove_v2: false,
      anon_remove_v2: false,
    });
  });
});
