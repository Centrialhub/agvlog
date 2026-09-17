import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150800_page_payroll_periods_before_projection.sql',
  'utf8',
);
const hook = readFileSync('src/hooks/usePayroll.tsx', 'utf8');
const page = readFileSync('src/pages/Payroll.tsx', 'utf8');

describe('payroll period bounded stable paging', () => {
  it('projects only IDs selected by the bounded page CTE', () => {
    expect(migration).toContain('page_ids as materialized');
    expect(migration).toContain('from page_ids');
    expect(migration.match(/finance_private\.payroll_period_projection\(/g)).toHaveLength(1);
    expect(migration.indexOf('page_ids as materialized')).toBeLessThan(migration.indexOf('finance_private.payroll_period_projection'));
  });

  it('returns and verifies a collection revision across navigation', () => {
    expect(migration).toContain('payroll_period_collection_changed');
    expect(migration).toContain("'collection_revision',(select value from revision)");
    expect(hook).toContain('collectionRevision');
    expect(page).toContain('collectionRevision:periodResult.collection_revision');
  });
});
