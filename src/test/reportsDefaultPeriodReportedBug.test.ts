import { describe, expect, it } from 'vitest';
import { reportsDefaultPeriod } from '@/lib/reports/reportDateRange';

describe('período padrão da tela Relatórios', () => {
  it('representa exatamente sete datas civis no calendário operacional', () => {
    const lateEveningInSaoPaulo = new Date('2026-09-22T01:00:00.000Z');

    expect(reportsDefaultPeriod(lateEveningInSaoPaulo)).toEqual({
      from: '2026-09-15',
      to: '2026-09-21',
    });
  });
});
