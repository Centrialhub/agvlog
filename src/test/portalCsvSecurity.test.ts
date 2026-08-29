import { describe, expect, it } from 'vitest';
import { escapePortalCsvCell } from '@/lib/portalCsv';

describe('CSV do portal', () => {
  it.each(['=1+1', '+SUM(A1:A2)', '-2+3', '@cmd', '  =HYPERLINK("https://example.invalid")'])(
    'neutraliza fórmula iniciada por %s',
    (value) => {
      expect(escapePortalCsvCell(value)).toContain("'");
      expect(escapePortalCsvCell(value).replace(/^"/, '')).toMatch(/^'/);
    },
  );

  it('preserva texto comum e escapa aspas e separadores', () => {
    expect(escapePortalCsvCell('Montes Claros')).toBe('Montes Claros');
    expect(escapePortalCsvCell('ACME, "Sul"')).toBe('"ACME, ""Sul"""');
  });
});
