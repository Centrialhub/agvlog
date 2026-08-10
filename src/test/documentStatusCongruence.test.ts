import { describe, it, expect } from 'vitest';
import {
  isConfirmedFiscalDoc,
  isConfirmedNfse,
  cteConsumesInvoices,
  isBillableNfse,
  fiscalDocRevenue,
} from '@/lib/fiscal/documentStatus';

describe('congruência de status fiscais', () => {
  it('CT-e em trânsito não é receita confirmada', () => {
    expect(isConfirmedFiscalDoc({ status: 'transmitting' })).toBe(false);
    expect(isConfirmedFiscalDoc({ status: 'draft' })).toBe(false);
    expect(isConfirmedFiscalDoc({ status: 'authorized' })).toBe(true);
    expect(isConfirmedFiscalDoc({ status: 'confirmed' })).toBe(true);
    expect(isConfirmedFiscalDoc({ status: 'cancelled' })).toBe(false);
    expect(isConfirmedFiscalDoc({ status: 'authorized', sefaz_status: 'rejeitado' })).toBe(false);
  });

  it('NFS-e em processamento consome NF mas não vira receita', () => {
    expect(isBillableNfse({ status: 'processing' })).toBe(true);
    expect(isConfirmedNfse({ status: 'processing' })).toBe(false);
    expect(isConfirmedNfse({ status: 'issued' })).toBe(true);
    expect(isConfirmedNfse({ status: 'cancelled' })).toBe(false);
  });

  it('rascunho de CT-e consome a NF; anulado devolve ao pool', () => {
    expect(cteConsumesInvoices({ status: 'draft' })).toBe(true);
    expect(cteConsumesInvoices({ status: 'generated' })).toBe(true);
    expect(cteConsumesInvoices({ status: 'cancelled' })).toBe(false);
    expect(cteConsumesInvoices({ status: 'rejeitado' })).toBe(false);
  });

  it('receita de CT-e nunca soma frete + valor', () => {
    expect(fiscalDocRevenue({ freight_value: 100, value: 100 })).toBe(100);
  });
});
