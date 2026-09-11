import { describe, expect, it } from 'vitest';
import { formatFinanceCents, parseFinanceAmount } from '@/lib/financial/ledgerContract';
describe('financial BRL entry and exact cent totals', () => {
  it('parses explicit Brazilian values without floating point arithmetic', () => {
    expect(parseFinanceAmount('R$ 1.234,56')).toBe(123456);
    expect(parseFinanceAmount('0,01')).toBe(1);
    expect(parseFinanceAmount('500')).toBe(50000);
    expect(parseFinanceAmount('999999999999,99')).toBe(99999999999999);
  });
  it('rejects zero, negatives, excessive decimal precision and ambiguous input', () => {
    for (const value of ['0', '-1', '1,234', '1.5', '1,000.00', 'NaN', '1e3', '', '1000000000000']) expect(parseFinanceAmount(value)).toBeNull();
  });
  it('formats server aggregate totals above Number precision without losing cents', () => {
    expect(formatFinanceCents('999999999999999999')).toBe('R$ 9.999.999.999.999.999,99');
    expect(formatFinanceCents(-501)).toBe('-R$ 5,01');
  });
});
