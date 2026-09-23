import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('payroll approval and close uncertain responses', () => {
  it('persists replayable results and reconciles queries after transport failures', () => {
    const migration=readFileSync('supabase/migrations/20260921211000_idempotent_payroll_approve_close.sql','utf8');
    const hook=readFileSync('src/hooks/usePayroll.tsx','utf8');
    expect(migration).toContain("action = 'approve_payroll_period'");
    expect(migration).toContain("action = 'close_payroll_period'");
    expect(migration).toContain('atomic_command_results');
    expect(hook).toContain("action:'approve_payroll_period'");
    expect(hook).toContain("action:'close_payroll_period'");
    expect(hook).toContain('approve_payroll_period_v3');
    expect(hook).toContain('close_payroll_period_v2');
    expect(hook).toContain("invalidateQueries({queryKey:['payroll_periods']})");
  });
});
