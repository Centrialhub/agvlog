import { describe, it, expect } from 'vitest';
import { canGenerateReturnSheet } from '@/hooks/useOccurrenceReturnSheet';
import { buildReturnSheetPdf } from '@/lib/occurrences/occurrenceReturnSheetPdf';
import type { ReturnSheet } from '@/hooks/useOccurrenceReturnSheet';

function makeSheet(overrides: Partial<ReturnSheet> = {}): ReturnSheet {
  return {
    id: 's1', tenant_id: 't1', occurrence_id: 'o1',
    sheet_number: 'SAC-2026-0001', sac_number: 'SAC-2026-0001',
    status: 'generated', version: 1, superseded_by: null,
    company_snapshot: {
      name: 'AGV DISTRIBUIÇÃO E LOGÍSTICA LTDA',
      load: { load_number: '5945', vehicle_plate: 'OPW7913', driver_name: 'LUIZ VIEIRA NETO' },
    },
    occurrence_snapshot: {
      occurrence_type: 'AVARIA DE MERCADORIA',
      occurrence_reason: 'AVARIA DA MERCADORIA',
      resolution_type: 'returned_partial',
      resolution_notes: 'DESCONTO NA FATURA',
      occurrence_date: '2026-07-02',
      closed_at: '2026-07-02T10:10:16Z',
      password_or_authorization: null,
    },
    invoice_snapshot: [{
      invoice_number: '575722', remitter: 'P.SEVERINI', recipient: 'MAC DISTRIBUIDORA', issue_date: '2026-06-25',
    }],
    product_snapshot: [{
      invoice_number: '575722', product_code: '114451',
      product_description: 'FOSFORO ARGOS 10UN.', unit: 'UN', quantity: 2, item_value: 840,
      quantity_problem: 10, return_type: null,
    }],
    pdf_url: null, generated_at: '2026-07-02T10:10:16Z', generated_by: null,
    printed_at: null, signed_at: null, signed_proof_url: null,
    receiver_name: null, receiver_document: null,
    cancellation_reason: null, cancelled_at: null,
    created_at: '2026-07-02', updated_at: '2026-07-02',
    ...overrides,
  };
}

describe('canGenerateReturnSheet', () => {
  it('blocks open occurrences', () => {
    const r = canGenerateReturnSheet({ status: 'open' });
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/Finalize/);
  });
  it('blocks in-review occurrences', () => {
    expect(canGenerateReturnSheet({ status: 'in_review', resolution_type: 'returned_total' }).ok).toBe(false);
  });
  it('blocks cancelled occurrences', () => {
    expect(canGenerateReturnSheet({ status: 'cancelled', resolution_type: 'returned_total' }).ok).toBe(false);
  });
  it('blocks resolved without solution', () => {
    expect(canGenerateReturnSheet({ status: 'resolved', resolution_type: null }).ok).toBe(false);
  });
  it('blocks resolved with disallowed solution', () => {
    expect(canGenerateReturnSheet({ status: 'resolved', resolution_type: 'other' }).ok).toBe(false);
  });
  it('accepts resolved with returned_partial', () => {
    expect(canGenerateReturnSheet({ status: 'resolved', resolution_type: 'returned_partial' }).ok).toBe(true);
  });
  it('accepts closed with returned_total', () => {
    expect(canGenerateReturnSheet({ status: 'closed', resolution_type: 'returned_total' }).ok).toBe(true);
  });
  it('accepts refused_by_customer', () => {
    expect(canGenerateReturnSheet({ status: 'closed', resolution_type: 'refused_by_customer' }).ok).toBe(true);
  });
});

describe('buildReturnSheetPdf', () => {
  it('produces a non-empty PDF blob', () => {
    const doc = buildReturnSheetPdf({ sheet: makeSheet() });
    const blob = doc.output('blob');
    expect(blob.size).toBeGreaterThan(500);
  });
  it('handles total return summary line', () => {
    const sheet = makeSheet({
      product_snapshot: [{
        invoice_number: '999',
        product_description: 'TODOS OS ITENS DA NF',
        return_type: 'TOTAL',
        notes: 'DEVOLUÇÃO TOTAL DA NF',
      }],
      occurrence_snapshot: {
        ...makeSheet().occurrence_snapshot,
        resolution_type: 'returned_total',
      },
    });
    const doc = buildReturnSheetPdf({ sheet });
    expect(doc.output('blob').size).toBeGreaterThan(500);
  });
  it('handles many products with page break', () => {
    const products = Array.from({ length: 60 }, (_, i) => ({
      invoice_number: '575722', product_code: String(1000 + i),
      product_description: 'PRODUTO ' + i, unit: 'UN', quantity: i, item_value: 10,
    }));
    const doc = buildReturnSheetPdf({ sheet: makeSheet({ product_snapshot: products }) });
    expect((doc as any).internal.getNumberOfPages()).toBeGreaterThan(1);
  });
});