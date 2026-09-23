import { describe, expect, it } from 'vitest';
import type { PalletProtocol } from '@/hooks/usePalletReturns';
import { protocolsToCsv } from '@/lib/palletReturns/palletReturnCsv';

describe('pallet return CSV civil dates', () => {
  it('preserves date-only columns without a UTC conversion', () => {
    const csv = protocolsToCsv([{
      protocol_number: 'PAL-1',
      issue_date: '2026-01-01',
      returned_at: '2026-12-31',
      supplier_name_snapshot: 'Fornecedor',
      status: 'returned',
      total_quantity: 1,
      items: [],
    } as unknown as PalletProtocol]);

    expect(csv).toContain('01/01/2026');
    expect(csv).toContain('31/12/2026');
    expect(csv).not.toContain('31/12/2025');
  });
});
