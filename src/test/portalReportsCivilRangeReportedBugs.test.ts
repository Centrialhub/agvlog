import { describe, expect, it } from 'vitest';
import { trailingCivilDateRange } from '@/lib/utils/formatDate';

describe('intervalo civil do relatório do portal', () => {
  const instant = new Date('2026-01-01T01:00:00.000Z');

  it('usa a data civil do fuso do tenant', () => {
    expect(trailingCivilDateRange(90, 'America/Sao_Paulo', instant)).toEqual({
      start: '2025-10-03',
      end: '2025-12-31',
    });
    expect(trailingCivilDateRange(90, 'Asia/Tokyo', instant)).toEqual({
      start: '2025-10-04',
      end: '2026-01-01',
    });
  });

  it('inclui exatamente 90 datas civis, contando hoje', () => {
    const range = trailingCivilDateRange(90, 'America/Sao_Paulo', instant);
    const elapsedDays = (Date.parse(range.end) - Date.parse(range.start)) / (24 * 60 * 60 * 1000);
    expect(elapsedDays).toBe(89);
  });
});
