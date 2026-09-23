import { describe, expect, it } from 'vitest';
import { shortageReportToCsv } from '@/lib/merchandiseShortages/shortageReportCsv';
import type { ShortageReportRow } from '@/lib/merchandiseShortages/shortageReportBuilder';

const row = (value: string): ShortageReportRow => ({
  occurrence_date: '2026-09-22', company_name: value, driver_name: value,
  invoice_number: value, city: value, customer_name: value, product_description: value,
  quantity_text: '1 UN', quantity: 1, unit: 'UN', unit_cost: 1, total_amount: 1,
  observation: value, status: value, responsible_party_type: value,
});

describe('shortage report CSV injection protection', () => {
  it.each(['=SUM(A1:A2)', '+cmd', '-2+3', '@payload', '  =HYPERLINK("x")', '\tformula', '\rformula'])(
    'neutralizes spreadsheet expression %s in every textual column',
    value => {
      const csv = shortageReportToCsv([row(value)]);
      expect(csv).toContain(`'${value.replace(/"/g, '""')}`);
    },
  );
});
