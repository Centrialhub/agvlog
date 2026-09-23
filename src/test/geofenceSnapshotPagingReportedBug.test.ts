import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('geofence dashboard paging revision regression', () => {
  it('binds continuation pages to the filtered collection revision and recovers conflicts', () => {
    const migration=readFileSync('supabase/migrations/20260922034000_revision_geofence_dashboard_pages.sql','utf8');
    const page=readFileSync('src/pages/Geofences.tsx','utf8');
    expect(migration).toContain("raise exception 'geofence_dashboard_snapshot_changed'");
    expect(migration).toContain('jsonb_agg(to_jsonb(geofence) order by');
    expect(page).toContain('_expected_revision:collectionRevision');
    expect(page).toContain('GeofenceDashboardSnapshotChangedError');
    expect(page).toContain('setCollectionRevision(current=>current??dashboard!.revision)');
  });
});
