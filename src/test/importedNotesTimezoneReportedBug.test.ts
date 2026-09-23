import { describe, expect, it } from 'vitest';
import { buildImportedAtFilter } from '@/lib/importedNotesFilters';

describe('imported notes tenant calendar filtering', () => {
  it('builds the full São Paulo civil day independently of the device timezone', () => {
    expect(buildImportedAtFilter(
      { importFrom: '2026-09-16', importTo: '2026-09-16' },
      'America/Sao_Paulo',
    )).toBe([
      'and(imported_at.gte.2026-09-16T03:00:00.000Z,imported_at.lt.2026-09-17T03:00:00.000Z)',
      'and(imported_at.is.null,created_at.gte.2026-09-16T03:00:00.000Z,created_at.lt.2026-09-17T03:00:00.000Z)',
    ].join(','));
  });

  it('uses the configured tenant timezone instead of a hardcoded browser boundary', () => {
    const filter = buildImportedAtFilter(
      { importFrom: '2026-07-01', importTo: '2026-07-01' },
      'America/New_York',
    );
    expect(filter).toContain('gte.2026-07-01T04:00:00.000Z');
    expect(filter).toContain('lt.2026-07-02T04:00:00.000Z');
  });
});
