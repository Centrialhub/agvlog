import {describe,expect,it} from 'vitest';
import {formatBillingIssueDate} from '@/lib/billingIssueDate';

describe('data civil de emissão no faturamento',()=>{
 it('preserva o dia gravado na tabela e no XML sem conversão UTC',()=>{
  expect(formatBillingIssueDate('2026-09-17')).toBe('17/09/2026');
  expect(`<Emissao>${formatBillingIssueDate('2026-09-17')}</Emissao>`).toBe('<Emissao>17/09/2026</Emissao>');
 });
 it('mantém os fallbacks usados pela tabela e pela exportação',()=>{
  expect(formatBillingIssueDate(null,'—')).toBe('—');
  expect(formatBillingIssueDate(null)).toBe('');
 });
});
