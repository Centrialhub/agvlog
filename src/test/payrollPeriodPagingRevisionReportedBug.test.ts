import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { payrollPeriodsProjectionSchema } from '@/lib/financial/payrollPaymentContract';

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

  it('accepts PostgreSQL timestamps with an explicit UTC offset', () => {
    expect(() => payrollPeriodsProjectionSchema.parse({
      version: 1,
      tenant_id: '6e874e6e-5bca-486d-9928-bef0646989c4',
      page: 1,
      page_size: 30,
      total: 0,
      snapshot_at: '2026-09-21T16:39:41.320384+00:00',
      collection_revision: '2e1cfa82b035c26cbbbdae632cea070514eb8b773f616aaeaf668e2f0be8f10d',
      rows: [],
    })).not.toThrow();
  });
});
