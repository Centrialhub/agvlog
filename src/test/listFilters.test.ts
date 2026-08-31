import { describe, expect, it } from 'vitest';
import { calendarDay, filterOptions, localDayBoundary, matchesDateRange, matchesSearch } from '@/lib/listFilters';

describe('list filtering', () => {
  it('combines words across fields, ignoring accents, case and whitespace', () => {
    expect(matchesSearch('  joao MONTES ', 'João da Silva', 'Montes Claros')).toBe(true);
    expect(matchesSearch('joao salinas', 'João da Silva', 'Montes Claros')).toBe(false);
    expect(matchesSearch('', null, undefined)).toBe(true);
    expect(matchesSearch('cte', 'CT-e')).toBe(true);
    expect(matchesSearch('ABC1D23', 'ABC-1D23')).toBe(true);
  });
  it('includes both calendar boundaries and excludes missing dates when a period is set', () => {
    expect(matchesDateRange('2026-08-30', '2026-08-30', '2026-08-30')).toBe(true);
    expect(matchesDateRange('2026-08-29', '2026-08-30', '')).toBe(false);
    expect(matchesDateRange(null, '', '2026-08-30')).toBe(false);
    expect(matchesDateRange(null, '', '')).toBe(true);
    expect(matchesDateRange('invalid', '2026-08-01', '')).toBe(false);
    expect(matchesDateRange('2026-08-30', '2026-08-31', '2026-08-01')).toBe(false);
  });
  it('uses local calendar days for timestamps and includes the last millisecond', () => {
    const start = new Date(2026, 7, 30, 0, 0, 0, 0);
    const last = new Date(2026, 7, 30, 23, 59, 59, 999);
    const next = new Date(2026, 7, 31, 0, 0, 0, 0);
    expect(calendarDay(start.toISOString())).toBe('2026-08-30');
    expect(matchesDateRange(last.toISOString(), '2026-08-30', '2026-08-30')).toBe(true);
    expect(matchesDateRange(next.toISOString(), '2026-08-30', '2026-08-30')).toBe(false);
    expect(localDayBoundary('2026-08-30')).toBe(start.toISOString());
    expect(localDayBoundary('2026-08-30', true)).toBe(next.toISOString());
  });
  it('removes absent and duplicate filter options', () => {
    expect(filterOptions(['Salinas', null, '', '  ', 'Montes Claros', 'Salinas'])).toEqual(['Montes Claros', 'Salinas']);
  });
});
