import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const inventory = readFileSync(
  join(process.cwd(), 'supabase', 'verify', 'security_boundary_inventory.sql'),
  'utf8',
);

describe('read-only Supabase security boundary inventory', () => {
  it('contains no persistent mutation or privilege change', () => {
    expect(inventory).toMatch(/begin transaction read only/i);
    expect(inventory).toMatch(/commit;/i);
    expect(inventory).not.toMatch(
      /^\s*(?:insert|update|delete|merge|grant|revoke|alter|create|drop|truncate)\b/gim,
    );
  });

  it('fails closed on the objective privilege violations', () => {
    expect(inventory).toContain('public.create_tenant_with_owner(text)');
    expect(inventory).toContain("has_function_privilege('anon'");
    expect(inventory).toContain("procedure.prorettype = 'pg_catalog.trigger'::regtype");
    expect(inventory).toContain("setting like 'search_path=%'");
    expect(inventory).toContain('has_any_column_privilege');
    expect(inventory.match(/raise exception/g)).toHaveLength(6);
  });

  it.each([
    'application_error_events',
    'application_web_vitals',
    'secure_upload_rate_events',
  ])('treats %s as a backend-only no-policy relation', (table) => {
    expect(inventory).toContain(`('${table}')`);
  });

  it('emits a function-level review inventory without pretending names are approvals', () => {
    expect(inventory).toContain('procedure.oid::regprocedure::text as signature');
    expect(inventory).toContain('definition_md5');
    expect(inventory).toContain('runtime_settings');
    expect(inventory).toContain('used_by_trigger');
    expect(inventory).toContain('policy_text_references');
    expect(inventory).toContain('guard_signal_detected');
    expect(inventory).toContain('review_api_without_detected_guard');
    expect(inventory).toContain('a name alone is never treated as sufficient authorization');
  });
});
