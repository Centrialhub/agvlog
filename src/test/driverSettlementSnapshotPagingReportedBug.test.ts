import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917151600_revision_driver_settlement_snapshot.sql', 'utf8');
const hooks = readFileSync('src/hooks/useDriverSettlements.tsx', 'utf8');
const page = readFileSync('src/pages/DriverSettlements.tsx', 'utf8');

describe('reported driver settlement snapshot bugs', () => {
  it('binds every continuation cursor to the filtered mutable collection revision', () => {
    expect(migration).toContain("md5(to_jsonb(base)::text)");
    expect(migration).toContain("'revision', totals.revision");
    expect(migration).toContain('v_cursor_revision is distinct from v_revision');
    expect(migration).toContain("raise exception 'settlement_snapshot_changed'");
    expect(hooks).toContain("error.code === '40001'");
    expect(hooks).toContain('new DriverSettlementSnapshotChangedError');
  });

  it('starts a fresh snapshot after refresh and every list-changing mutation', () => {
    expect(page).toContain('useDriverSettlementCollectionEpoch()');
    expect(page).toContain('collectionEpochRef.current!==collectionEpoch');
    expect(page).toContain('resetPaging(); if (needsExplicitRefetch) void refetchSettlements()');
    expect(page).toContain('if (driverOptionPage === 1) void driverOptions.refetch()');
    expect(hooks.match(/invalidateDriverSettlementCollection\(qc\)/g)?.length).toBeGreaterThanOrEqual(9);
    expect(hooks).not.toMatch(/onSuccess:[\s\S]{0,500}qc\.invalidateQueries\(\{ queryKey: \['driver_settlements'\]/);
  });
});
