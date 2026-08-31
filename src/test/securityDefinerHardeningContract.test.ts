import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(join(
  process.cwd(),
  'supabase',
  'migrations',
  '20260830005603_close_authenticated_security_definer_surface.sql',
), 'utf8');

describe('targeted SECURITY DEFINER hardening', () => {
  it('revokes only explicit signatures without schema-wide or name-only loops', () => {
    expect(migration).not.toContain('for routine in');
    expect(migration).not.toContain('all functions in schema');
    expect(migration).not.toContain('pg_proc');
    expect(migration).toContain('public, anon, authenticated');
  });

  it.each([
    'assign_fiscal_documents_to_load(uuid, uuid, uuid[])',
    'remove_fiscal_documents_from_load(uuid, uuid, uuid[])',
    'driver_report_event_v1(uuid, uuid, uuid, uuid, text, jsonb, text)',
    'create_load_v1(uuid, uuid, uuid, text, text, text, text, timestamp with time zone, text)',
    'update_load_v1(uuid, uuid, jsonb, integer)',
    'handle_new_user()',
  ])('removes browser execution from %s', (signature) => {
    expect(migration).toContain(
      `revoke all privileges on function public.${signature} from public, anon, authenticated;`,
    );
  });

  it('preserves the canonical fiscal document and driver event APIs', () => {
    expect(migration).not.toMatch(/revoke[^;]+assign_fiscal_documents_to_load_v2/);
    expect(migration).not.toMatch(/revoke[^;]+remove_fiscal_documents_from_load_v2/);
    expect(migration).not.toMatch(/revoke[^;]+driver_create_operational_occurrence/);
    expect(migration).not.toMatch(/revoke[^;]+on function public\.plan_dispatch_trip_v3/);
  });
});
