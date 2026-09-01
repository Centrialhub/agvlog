import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260901001442_revoke_reintroduced_legacy_composition_acl.sql',
), 'utf8').replace(/\r\n/g, '\n');

const legacyMigration = readFileSync(join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260901001826_revoke_reintroduced_legacy_security_definers.sql',
), 'utf8').replace(/\r\n/g, '\n');

describe('legacy document composition ACL regression', () => {
  it.each([
    'assign_fiscal_documents_to_load',
    'remove_fiscal_documents_from_load',
  ])('removes authenticated execution from %s with an exact signature', (name) => {
    expect(migration).toContain(
      `public.${name}(uuid, uuid, uuid[])\nfrom public, anon, authenticated;`,
    );
  });

  it('pins all four function bodies before changing privileges', () => {
    expect(migration.match(/pg_get_functiondef/g)).toHaveLength(4);
    expect(migration).toContain('assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[])');
    expect(migration).toContain('remove_fiscal_documents_from_load_v2(uuid,uuid,uuid[])');
  });

  it('does not revoke the canonical v2 browser APIs', () => {
    const revocations = migration.match(/revoke\s+all\s+privileges[\s\S]*?;/gi) ?? [];
    expect(revocations.join('\n')).not.toContain('assign_fiscal_documents_to_load_v2');
    expect(revocations.join('\n')).not.toContain('remove_fiscal_documents_from_load_v2');
  });
});

describe('recreated privileged legacy ACL regression', () => {
  const signatures = [
    'audit_data_consistency_v4(uuid)',
    'audit_operational_congruence_v1(uuid)',
    'create_employee_v1(uuid,jsonb)',
    'create_load_with_next_number(uuid,text,text,uuid,uuid,text,text)',
    'delete_employee_v1(uuid,uuid)',
    'delete_load_v1(uuid,uuid)',
    'get_driver_workspace_v1(uuid,uuid)',
    'get_operational_financial_summary_v1(uuid,date,date)',
    'list_employees_v1(uuid,text,text,integer,integer)',
    'log_operational_event_v2(uuid,text,uuid,uuid,jsonb,jsonb,text)',
    'move_load_items_v3(uuid,uuid,uuid,uuid[])',
    'update_employee_v1(uuid,uuid,jsonb,integer)',
    'update_load_v1(uuid,uuid,jsonb,integer)',
  ];

  it.each(signatures)('revokes authenticated execution from %s', (signature) => {
    expect(legacyMigration).toContain(`public.${signature}`);
  });

  it('pins every body and uses one explicit browser-role revocation', () => {
    expect(legacyMigration.match(/'public\.[^']+','[0-9a-f]{32}'/g)).toHaveLength(signatures.length);
    expect(legacyMigration).toContain('from public, anon, authenticated;');
    expect(legacyMigration).not.toContain('pg_proc');
    expect(legacyMigration).not.toContain('all functions in schema');
  });
});
