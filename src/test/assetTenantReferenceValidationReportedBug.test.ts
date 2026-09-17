import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150100_validate_asset_tenant_references.sql',
  'utf8',
);

describe('historical asset tenant references', () => {
  it('checks every historical cross-tenant relationship before release', () => {
    expect(migration).toContain('asset_tenant_reconciliation_required');
    expect(migration).toContain('v_asset_responsible > 0');
    expect(migration).toContain('v_movement_asset > 0');
    expect(migration).toContain('v_movement_from > 0');
    expect(migration).toContain('v_movement_to > 0');
  });

  it('adds and validates composite tenant foreign keys for all four references', () => {
    expect(migration.match(/foreign key \(tenant_id,/g)).toHaveLength(4);
    expect(migration.match(/validate constraint/g)).toHaveLength(4);
    expect(migration).toContain('assets_tenant_responsible_employee_fkey');
    expect(migration).toContain('asset_movements_tenant_asset_fkey');
    expect(migration).toContain('asset_movements_tenant_from_employee_fkey');
    expect(migration).toContain('asset_movements_tenant_to_employee_fkey');
  });
});
