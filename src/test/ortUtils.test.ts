import { describe, expect, it } from 'vitest';

import {
  buildOrtAccessKey,
  dedupeOrtReviewDocs,
  getChangedOrtFields,
  mapOrtItems,
  normalizeOrtKeyPart,
  toOrtAuditPayload,
} from '@/lib/ingestion/ortUtils';
import type { OrtReviewDocument } from '@/lib/ingestion/types';

function makeOrt(overrides: Partial<OrtReviewDocument> = {}): OrtReviewDocument {
  return {
    documentKind: 'ort',
    invoiceNumber: '123',
    issueDate: '2026-08-01',
    paymentTerms: '',
    billing: '',
    cargoDescription: 'Mercadoria',
    emitterName: 'Emitente',
    emitterCnpj: '12345678000190',
    recipientName: 'Cliente São João',
    recipientCnpj: '11222333000144',
    recipientPhone: '',
    recipientCity: 'São Paulo',
    recipientState: 'SP',
    recipientAddress: 'Rua A',
    recipientAddressNumber: '10',
    recipientZip: '01001000',
    recipientNeighborhood: 'Centro',
    totalValue: 10,
    totalWeight: 2,
    totalVolume: 1,
    estimatedPallets: 1,
    productSummary: 'Mercadoria',
    confidence: 0.9,
    needsReview: false,
    fileName: 'ort.pdf',
    sourcePages: ['pagina-1.png'],
    items: [{
      description: 'Produto A',
      quantity: 1,
      unit: 'UN',
      unitPrice: 10,
      totalPrice: 10,
    }],
    ...overrides,
  };
}

describe('ORT ingestion utilities', () => {
  it('normaliza partes da chave de forma estável', () => {
    expect(normalizeOrtKeyPart(' São João / SP ')).toBe('SAOJOAOSP');
    expect(buildOrtAccessKey(makeOrt(), 'DOC1')).toBe(
      'ORT-123-11222333000144-SAOPAULO-20260801-1000',
    );
  });

  it('consolida páginas repetidas da mesma ORT', () => {
    const secondPage = makeOrt({
      totalValue: 20,
      totalWeight: 3,
      sourcePages: ['pagina-2.png'],
      items: [{
        description: 'Produto A',
        quantity: 2,
        unit: 'UN',
        unitPrice: 10,
        totalPrice: 20,
      }],
    });

    const result = dedupeOrtReviewDocs([makeOrt(), secondPage], []);

    expect(result.batchDuplicates).toBe(1);
    expect(result.uniqueDocs).toHaveLength(1);
    expect(result.uniqueDocs[0].totalValue).toBe(20);
    expect(result.uniqueDocs[0].totalWeight).toBe(3);
    expect(result.uniqueDocs[0].items).toHaveLength(2);
    expect(result.uniqueDocs[0].sourcePages).toEqual(['pagina-1.png', 'pagina-2.png']);
  });

  it('remove ORT já persistida pela chave de acesso', () => {
    const doc = makeOrt();
    const accessKey = buildOrtAccessKey(doc, 'DOC1');
    const result = dedupeOrtReviewDocs([doc], [{ access_key: accessKey }]);

    expect(result.uniqueDocs).toHaveLength(0);
    expect(result.existingDuplicates).toBe(1);
  });

  it('não combina documentos sem identidade usando aleatoriedade', () => {
    const unidentified = makeOrt({
      invoiceNumber: '',
      recipientCnpj: '',
      recipientName: '',
      recipientCity: '',
      recipientAddress: '',
      recipientAddressNumber: '',
    });

    const result = dedupeOrtReviewDocs([unidentified, { ...unidentified }], []);

    expect(result.uniqueDocs).toHaveLength(2);
    expect(result.uniqueDocs.map((doc) => doc.unifiedDocId)).toEqual([
      'RAW#ort.pdf#0',
      'RAW#ort.pdf#1',
    ]);
  });

  it('não inventa item quando a extração não contém produtos', () => {
    expect(mapOrtItems(makeOrt({ items: [], totalValue: 42.5, productSummary: 'Carga geral' }))).toEqual([]);
  });

  it('não combina ORTs de emitentes e destinatários distintos que reutilizam numeração', () => {
    const result = dedupeOrtReviewDocs([
      makeOrt(),
      makeOrt({ emitterCnpj: '99888777000166' }),
    ], []);

    expect(result.uniqueDocs).toHaveLength(2);
    expect(result.batchDuplicates).toBe(0);
  });

  it('compara o payload extraído com o revisado', () => {
    const original = makeOrt();
    const unchanged = { ...original, extractedPayload: toOrtAuditPayload(original) };
    const changed = { ...unchanged, recipientCity: 'Campinas' };

    expect(getChangedOrtFields(unchanged)).toEqual([]);
    expect(getChangedOrtFields(changed)).toContain('recipientCity');
  });
});
