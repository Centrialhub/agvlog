import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('legacy cost center snapshot regression', () => {
  it('binds continuation pages to a frozen snapshot and collection revision', () => {
    const migration = readFileSync('supabase/migrations/20260922032000_snapshot_legacy_cost_center_report.sql', 'utf8');
    const page = readFileSync('src/pages/LegacyCostCenters.tsx', 'utf8');

    expect(migration).toContain("raise exception 'legacy_cost_center_snapshot_changed'");
    expect(migration).toContain('md5(coalesce(jsonb_agg');
    expect(migration).toContain("'snapshot_at',effective_snapshot,'revision',revision.value");
    expect(page).toContain('_expected_revision: collectionRevision');
    expect(page).toContain('LegacyCostCenterSnapshotChangedError');
    expect(page).toContain('setCollectionRevision(current => current ?? report!.revision)');
  });
});
