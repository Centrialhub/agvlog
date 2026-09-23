import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('snapshot da paginação de romaneios disponíveis', () => {
  it('valida a revisão no banco e reinicia a interface quando o conjunto muda', () => {
    const migration = readFileSync(
      'supabase/migrations/20260922046000_snapshot_available_settlement_loads.sql',
      'utf8',
    );
    const hook = readFileSync('src/hooks/useDriverSettlements.tsx', 'utf8');
    const picker = readFileSync('src/components/financial/LoadPicker.tsx', 'utf8');
    expect(migration).toContain('_expected_revision text default null');
    expect(migration).toContain("raise exception 'settlement_snapshot_changed' using errcode='40001'");
    expect(migration).toContain("'revision',v_revision");
    expect(hook).toContain('_expected_revision: expectedRevision');
    expect(hook).toContain('availableLoadRevisions.delete(revisionKey)');
    expect(picker).toContain('error instanceof DriverSettlementSnapshotChangedError');
    expect(picker).toContain('setPage(1)');
  });
});
