import { describe, expect, it } from 'vitest';
import { normalizeOrderOptionalFields } from '@/lib/orders/orderFormNormalization';

describe('order optional date normalization', () => {
  it('sends blank issue and promised dates as null', () => {
    const payload = normalizeOrderOptionalFields({
      order_number: 'QA-ORDER',
      issue_date: '',
      promised_date: '',
      city: '',
      quantity: 0,
    });

    expect(payload).toMatchObject({
      order_number: 'QA-ORDER',
      issue_date: null,
      promised_date: null,
      city: null,
      quantity: 0,
    });
  });

  it('preserves valid dates', () => {
    expect(normalizeOrderOptionalFields({
      issue_date: '2026-09-21',
      promised_date: '2026-09-30',
    })).toMatchObject({
      issue_date: '2026-09-21',
      promised_date: '2026-09-30',
    });
  });
});
