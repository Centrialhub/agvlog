import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917140500_page_statement_import_history.sql', 'utf8');
const snapshotMigration = readFileSync('supabase/migrations/20260917145000_snapshot_statement_import_history.sql', 'utf8');
const detail = readFileSync('src/components/financial/StatementHistoryDetail.tsx', 'utf8');

describe('reported statement-history payload regression', () => {
  it('keeps history out of line pages and exposes a bounded history endpoint', () => {
    expect(migration).toContain("'history','[]'::jsonb");
    expect(migration).toContain('limit _page_size offset (_page-1)*_page_size');
    expect(migration).toContain('list_finance_statement_history_v1');
    expect(detail).toContain('readFinanceStatementHistory');
    expect(detail).toContain('setHistoryPage(page=>page+1)');
    expect(detail).not.toContain('data.history.map');
  });

  it('freezes all history pages at the snapshot returned by the first request', () => {
    expect(snapshotMigration).toContain("'snapshot_at', snapshot_at");
    expect(snapshotMigration).toContain('and e.created_at <= snapshot_at');
    expect(snapshotMigration).toContain('_snapshot_at timestamptz default null');
    expect(detail).toContain('historySnapshot.current');
    expect(detail).toContain('historySnapshot.current??=result.snapshot_at');
  });
});
