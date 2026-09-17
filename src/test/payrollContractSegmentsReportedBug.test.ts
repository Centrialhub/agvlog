import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150600_cover_all_payroll_contract_segments.sql',
  'utf8',
);

describe('payroll contract segments and terminated employee scope', () => {
  it('sums every contract segment overlapping the competence', () => {
    expect(migration).toContain('select sum(round(contract.base_salary');
    expect(migration).toContain('contract.start_date<=_period_end');
    expect(migration).toContain('contract.end_date>=_period_start');
    expect(migration).toContain('Salário base proporcional dos contratos');
  });

  it('keeps employees who worked during the period in generation and cleanup scope', () => {
    expect(migration).toContain('employee.hire_date <= _period_end');
    expect(migration).toContain('employee.termination_date >= _period_start');
    expect(migration).toContain('employee.termination_date between _period_start and _period_end');
    expect(migration.match(/payroll_employee_in_scope_v1\(/g)?.length ?? 0).toBeGreaterThanOrEqual(4);
  });
});
