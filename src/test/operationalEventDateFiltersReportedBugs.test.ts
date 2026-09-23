import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';

import { operationalEventDateBounds, operationalEventMonthKey, trailingOperationalEventMonths } from '@/lib/operationalEvents/operationalEventDates';
import { localDateInputValue, shiftDateInputValue } from '@/lib/utils/formatDate';

describe('operational event civil-date boundaries', () => {
  it('includes the complete selected final day in the tenant timezone', () => {
    const selected = new Date(2026, 8, 17, 12);
    expect(operationalEventDateBounds(selected, selected, 'America/Sao_Paulo')).toEqual({
      fromInclusive: '2026-09-17T03:00:00.000Z',
      toInclusive: '2026-09-18T02:59:59.999Z',
      toExclusive: '2026-09-18T03:00:00.000Z',
    });
    expect(operationalEventDateBounds(selected, selected, 'America/Manaus')).toEqual({
      fromInclusive: '2026-09-17T04:00:00.000Z',
      toInclusive: '2026-09-18T03:59:59.999Z',
      toExclusive: '2026-09-18T04:00:00.000Z',
    });
  });

  it('builds today and prior-day presets from the tenant calendar', () => {
    const instant = new Date('2026-09-17T00:30:00.000Z');
    const today = localDateInputValue(instant, 'America/Sao_Paulo');
    expect(today).toBe('2026-09-16');
    expect(shiftDateInputValue(today, -7)).toBe('2026-09-09');
  });

  it('uses the exclusive next-day boundary for the XLSX load summary', () => {
    const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');
    expect(page).toContain('const periodToExclusive = selectedBounds.toExclusive');
    expect(page).toContain(".lt('created_at', periodToExclusive)");
    expect(page).not.toContain(".lte('created_at', periodTo.toISOString())");
  });

  it('uses the tenant calendar for monthly buckets and the trailing month labels', () => {
    const instant = '2026-09-01T03:30:00.000Z';
    expect(operationalEventMonthKey(instant, 'America/Manaus')).toBe('2026-08');
    expect(operationalEventMonthKey(instant, 'UTC')).toBe('2026-09');
    expect(trailingOperationalEventMonths('2026-09-22', 3).map(month => month.key)).toEqual(['2026-07', '2026-08', '2026-09']);
  });

  it('formats exported and displayed occurrence timestamps in the tenant timezone', () => {
    const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');
    const drawers = readFileSync('src/components/operational-events/OperationalEventDrawers.tsx', 'utf8');
    expect(page).toContain('fmtDateTimeInTimeZone(e.created_at, tenantTimezone)');
    expect(page).toContain('fmtDateTimeInTimeZone(e.resolved_at, tenantTimezone)');
    expect(drawers).toContain('fmtDateTimeInTimeZone(event.created_at, timeZone)');
    expect(page).not.toMatch(/format\(new Date\((?:e|ev|event)\.(?:created_at|resolved_at)/);
  });
});
