import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150900_snapshot_account_artifact_pages.sql',
  'utf8',
);
const dialog = readFileSync('src/components/financial/StatementImportDialog.tsx', 'utf8');

describe('bank account artifact snapshot paging', () => {
  it('counts and pages only artifacts visible at the frozen snapshot', () => {
    expect(migration.match(/artifact\.created_at<=snapshot_at|candidate\.created_at<=snapshot_at/g)).toHaveLength(2);
    expect(migration).toContain("'snapshot_at',snapshot_at");
  });

  it('carries the server snapshot when advancing the offset', () => {
    expect(dialog).toContain('_snapshot_at:snapshotAt||null');
    expect(dialog).toContain('setSnapshotAt(q.data!.snapshot_at)');
    expect(dialog).toContain("setSnapshotAt('')");
  });
});
