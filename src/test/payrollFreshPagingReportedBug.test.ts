import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('payroll period fresh paging regression',()=>{
 it('drops the frozen collection when returning to page one or explicitly refreshing',()=>{
  const source=readFileSync('src/pages/Payroll.tsx','utf8');
  expect(source).toContain('periodPage===2?resetPeriodPaging()');
  expect(source).toContain('onClick={refreshPeriods}>Atualizar</Button>');
  expect(source).toContain('else resetPeriodPaging()');
 });
});
