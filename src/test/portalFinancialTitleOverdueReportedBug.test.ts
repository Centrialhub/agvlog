import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260921131000_derive_portal_financial_title_overdue_status.sql',
  'utf8',
);

describe('portal financial title overdue status regression', () => {
  it('derives overdue from an open status, a past due date, and an outstanding balance', () => {
    expect(migration).toContain("r.status in ('pending', 'invoiced', 'partial')");
    expect(migration).toContain("coalesce(ci.due_date, r.due_date) < v_today");
    expect(migration).toContain("greatest(r.amount - coalesce(r.received_amount, 0), 0) > 0");
    expect(migration).toContain("then 'overdue'");
  });

  it('filters on the derived status instead of the materialized receivable status', () => {
    expect(migration).toContain('from candidates');
    expect(migration).toContain('where _status is null or status = any(_status)');
    expect(migration).not.toContain('or r.status = any(_status)');
  });
});
