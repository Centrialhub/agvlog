import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917151500_bound_account_period_evidence_history.sql', 'utf8');
const client = readFileSync('src/lib/financial/accountPeriodCloseClient.ts', 'utf8');
const bankPanel = readFileSync('src/components/financial/AccountPeriodClosePanel.tsx', 'utf8');
const cashPanel = readFileSync('src/components/financial/CashPeriodClosePanel.tsx', 'utf8');

describe('reported account period evidence and history paging bugs', () => {
  it('removes the full dependency array and compares integrity without rebuilding JSON aggregates', () => {
    expect(migration).toContain("paged_snapshot:=jsonb_set(c.snapshot,'{facts,movements}',movements,true)-'dependencies'");
    const integrity = migration.slice(migration.indexOf('if jsonb_typeof(c.snapshot'), migration.indexOf('return jsonb_build_object'));
    expect(integrity).not.toContain('jsonb_agg');
    expect(integrity).toContain('not exists');
    expect(integrity).toContain('expected_dependency_total=dependency_total');
  });

  it('carries one server snapshot through both bank and cash history pages', () => {
    expect(migration).toContain("'snapshot_at',effective_snapshot");
    expect(migration).toContain('c.created_at<=effective_snapshot');
    expect(migration).toContain('r.created_at<=effective_snapshot');
    expect(client).toContain('_snapshot_at:snapshotAt');
    expect(bankPanel).toContain('current??history.snapshot_at');
    expect(cashPanel).toContain('current??history.snapshot_at');
  });
});
