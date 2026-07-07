import { describe, it, expect } from 'vitest';
import { computeInvoiceTotals } from '@/lib/clientInvoicePdf';

describe('computeInvoiceTotals', () => {
  it('não duplica frete quando um CT-e tem várias NFs (uma charge por CT-e)', () => {
    const charges = [{ gross_amount: 1562.80 }];
    expect(computeInvoiceTotals(charges).total).toBeCloseTo(1562.80, 2);
  });

  it('cenário do PDF de exemplo: 1562.80 + 2279.34 + 500 = 4342.14', () => {
    const charges = [
      { gross_amount: 1562.80 },
      { gross_amount: 2279.34 },
      { gross_amount: 500.00 },
    ];
    const t = computeInvoiceTotals(charges);
    expect(t.gross).toBeCloseTo(4342.14, 2);
    expect(t.total).toBeCloseTo(4342.14, 2);
  });

  it('aplica desconto e juros: total = bruto - desconto + juros', () => {
    const t = computeInvoiceTotals([{ gross_amount: 1000 }], 100, 25);
    expect(t.total).toBeCloseTo(925, 2);
  });

  it('somar múltiplas charges (nunca somar por linha de detalhe)', () => {
    const charges = [{ gross_amount: 800 }, { gross_amount: 200 }];
    expect(computeInvoiceTotals(charges).total).toBeCloseTo(1000, 2);
  });
});