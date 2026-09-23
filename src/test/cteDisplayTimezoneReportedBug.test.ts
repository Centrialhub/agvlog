import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { fmtDateInTimeZone, fmtDateTimeInTimeZone } from '@/lib/utils/formatDate';

describe('horários operacionais de CT-e', () => {
  it('formata data e hora no timezone do tenant', () => {
    const instant = '2026-08-31T03:30:00.000Z';
    expect(fmtDateInTimeZone(instant, 'America/Manaus')).toBe('30/08/2026');
    expect(fmtDateTimeInTimeZone(instant, 'America/Manaus')).toBe('30/08/2026 23:30');
  });

  it('propaga o timezone às listas, ao detalhe, aos eventos e ao CSV', () => {
    const monitor = readFileSync('src/pages/CteMonitor.tsx', 'utf8');
    const search = readFileSync('src/pages/CteSearch.tsx', 'utf8');
    expect(monitor).toContain('fmtDateInTimeZone(r.issued_at, tenantTimezone)');
    expect(monitor).toContain('fmtDateTimeInTimeZone(e.occurred_at, timeZone)');
    expect(search).toContain('fmtDateInTimeZone(r.issued_at, tenantTimezone)');
    expect(search).toContain('toCsv(rows, tenantTimezone)');
  });
});
