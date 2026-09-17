import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150400_validate_vehicle_maintenance_tenant_refs.sql',
  'utf8',
);

describe('historical vehicle maintenance tenant references', () => {
  it('detects each historical reference mismatch before applying constraints', () => {
    expect(migration).toContain('vehicle_maintenance_tenant_reconciliation_required');
    for (const count of ['v_vehicle > 0', 'v_asset > 0', 'v_employee > 0', 'v_incident > 0']) {
      expect(migration).toContain(count);
    }
  });

  it('validates composite tenant references for every maintenance relation', () => {
    expect(migration.match(/foreign key \(tenant_id,/g)).toHaveLength(4);
    expect(migration.match(/validate constraint/g)).toHaveLength(4);
    for (const relation of ['vehicle', 'asset', 'employee', 'incident']) {
      expect(migration).toContain(`vehicle_maintenance_tenant_${relation}_fkey`);
    }
  });
});
