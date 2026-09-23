import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contrato de pendências da folha', () => {
  it('mantém os novos hooks no mock integral da tela', () => {
    const test = readFileSync('src/test/financePayrollScreen.test.tsx', 'utf8');
    expect(test).toContain('usePayrollGenerationIssues:');
    expect(test).toContain('useChangePayrollPeriodState:');
  });

  it('invalida pendências depois de recalcular o período', () => {
    const hook = readFileSync('src/hooks/usePayroll.tsx', 'utf8');
    const generation = hook.slice(hook.indexOf('export function useGeneratePayrollPeriod'), hook.indexOf('export function useRecalculatePayrollEntry'));
    expect(generation).toContain("invalidateQueries({ queryKey: ['payroll_generation_issues'] })");
  });

  it('usa aprovação idempotente v3 que preserva os diagnósticos da v2', () => {
    const hook = readFileSync('src/hooks/usePayroll.tsx', 'utf8');
    const migration = readFileSync('supabase/migrations/20260921114500_persist_payroll_approval_issues.sql', 'utf8');
    const idempotent = readFileSync('supabase/migrations/20260921211000_idempotent_payroll_approve_close.sql', 'utf8');
    expect(hook).toContain("'approve_payroll_period_v3'");
    expect(idempotent).toContain('v_result := public.approve_payroll_period_v2(_period_id)');
    expect(hook).toContain("invalidateQueries({ queryKey: ['payroll_generation_issues'] })");
    expect(migration).toContain("return jsonb_build_object(");
    expect(migration).toContain("'approved', p.status = 'approved'");
    expect(migration).toContain('Return normally so diagnostics inserted earlier in this transaction remain durable.');
  });
});
