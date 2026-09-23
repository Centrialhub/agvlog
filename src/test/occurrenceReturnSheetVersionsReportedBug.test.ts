import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { partitionReturnSheets, type ReturnSheet } from '@/hooks/useOccurrenceReturnSheet';

const page = readFileSync('src/pages/OccurrenceReturnSheet.tsx', 'utf8');
const sheet = (id: string, version: number, status: ReturnSheet['status']) => ({
  id, version, status,
} as ReturnSheet);

describe('occurrence return sheet version selection', () => {
  it('displays a lone cancelled sheet while keeping generation eligibility separate', () => {
    const result = partitionReturnSheets([sheet('cancelled', 1, 'cancelled')]);
    expect(result.activeSheet).toBeNull();
    expect(result.displaySheet?.id).toBe('cancelled');
    expect(result.historicalSheets).toEqual([]);
  });

  it('excludes the actual displayed sheet by id instead of dropping the first row', () => {
    const result = partitionReturnSheets([
      sheet('latest-cancelled', 3, 'cancelled'),
      sheet('active', 2, 'printed'),
      sheet('old', 1, 'superseded'),
    ]);
    expect(result.displaySheet?.id).toBe('active');
    expect(result.historicalSheets.map(item => item.id)).toEqual(['latest-cancelled', 'old']);
    expect(page).toContain('historicalSheets.map');
    expect(page).not.toContain('(sheetsQuery.data ?? []).slice(1)');
  });
});
