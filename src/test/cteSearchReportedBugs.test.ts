import { describe, expect, it } from 'vitest';
import {
  isCteCancellationAllowed,
  isExactCteSelection,
  reconcileCteSelection,
  toCsv,
  validateCteSearchDates,
} from '@/pages/CteSearch';
import type { CteSearchRow } from '@/hooks/useCteSearch';

function row(overrides: Partial<CteSearchRow> = {}): CteSearchRow {
  return {
    id: 'cte-1', source: 'hub', cte_number: '1', cte_series: '1', cte_type: 'normal',
    access_key: null, sefaz_status: 'processed', sefaz_status_reason: null,
    issued_at: '2026-09-17', created_at: '2026-09-17T12:00:00Z', payer_name: null,
    remitter: null, recipient: null, recipient_city: null, recipient_state: null,
    vehicle_plate: null, driver_name: null, invoice_numbers: null, freight_value: 1,
    cargo_value: 2, hub_document_id: 'hub-1', emission_id: null, pdf_url: null,
    xml_url: null, ...overrides,
  };
}

describe('reported CT-e search regressions', () => {
  it('rejects an inverted issuance range', () => {
    expect(validateCteSearchDates({ issueDateStart: '2026-09-20', issueDateEnd: '2026-09-10' })).toContain('posterior');
    expect(validateCteSearchDates({ issueDateStart: '2026-09-10', issueDateEnd: '2026-09-20' })).toBeNull();
  });

  it('never offers fiscal cancellation for a rejected document', () => {
    expect(isCteCancellationAllowed(row({ sefaz_status: 'rejected' }))).toBe(false);
    expect(isCteCancellationAllowed(row({ sefaz_status: 'processed' }))).toBe(true);
  });

  it('neutralizes spreadsheet formulas in exported fields', () => {
    const csv = toCsv([row({ recipient: '=HYPERLINK("https://example.invalid")' })]);
    expect(csv).toContain("'=HYPERLINK");
    expect(csv).not.toContain('"=HYPERLINK');
  });

  it('requires the same ids for select-all and removes ids lost after refresh', () => {
    expect(isExactCteSelection(new Set(['old']), ['new'])).toBe(false);
    expect(isExactCteSelection(new Set(['a', 'b']), ['a', 'b'])).toBe(true);
    expect([...reconcileCteSelection(new Set(['a', 'removed']), ['a', 'b'])]).toEqual(['a']);
  });
});
