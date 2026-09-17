import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150000_validate_tracker_tenant_refs.sql',
  'utf8',
);

describe('historical tracker tenant references', () => {
  it('blocks validation with explicit mismatch counts instead of accepting contaminated rows', () => {
    expect(migration).toContain('tracker_tenant_reconciliation_required');
    expect(migration).toContain('v_account_mismatches > 0');
    expect(migration).toContain('v_vehicle_mismatches > 0');
    expect(migration).toContain('v_unit_mismatches > 0');
  });

  it('validates all three formerly NOT VALID tenant constraints', () => {
    expect(migration).toContain('validate constraint provider_units_tenant_account_fkey');
    expect(migration).toContain('validate constraint vehicle_tracker_links_tenant_vehicle_fkey');
    expect(migration).toContain('validate constraint vehicle_tracker_links_tenant_unit_fkey');
    expect(migration).toContain('and not constraint_row.convalidated');
  });
});
