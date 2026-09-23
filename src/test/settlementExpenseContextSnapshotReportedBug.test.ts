import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('snapshot dos gastos conferidos do acerto', () => {
  it('recusa uma página calculada sobre revisão diferente', () => {
    const migration = readFileSync('supabase/migrations/20260922047000_snapshot_settlement_expense_context.sql', 'utf8');
    expect(migration).toContain('_expected_revision text default null');
    expect(migration).toContain("raise exception 'finance_settlement_expense_context_changed' using errcode='40001'");
    expect(migration).toContain("'revision',f.revision");
  });

  it('reutiliza uma única cobertura e uma única origem efetiva por gasto', () => {
    const migration = readFileSync('supabase/migrations/20260922048000_reuse_settlement_expense_assessments.sql', 'utf8');
    expect(migration.match(/finance_private\.expense_cost_coverage\(/g)).toHaveLength(1);
    expect(migration.match(/finance_private\.expense_cost_effective\(/g)).toHaveLength(1);
    expect(migration).not.toContain('finance_private.effective_cost_amount(');
    expect(migration).toContain('raw_source as materialized');
    expect(migration).toContain('source_rows as materialized');
    expect(migration).toContain('from assessed');
  });
});
