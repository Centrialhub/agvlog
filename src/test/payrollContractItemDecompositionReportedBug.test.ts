import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('payroll contract salary item decomposition regression',()=>{
 it('creates a proportional salary item for every overlapping contract',()=>{
  const migration=readFileSync('supabase/migrations/20260922036000_decompose_payroll_contract_salary_items.sql','utf8');
  expect(migration).toContain("'employee_contracts',contract.id");
  expect(migration).toContain('contract.start_date<=_period_end');
  expect(migration).toContain('contract.end_date is null or contract.end_date>=_period_start');
  expect(migration).toContain('round(contract.base_salary *');
  expect(migration).not.toContain("'employee_contracts', _emp.contract_id");
 });
});
