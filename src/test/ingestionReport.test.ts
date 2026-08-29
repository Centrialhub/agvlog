import { describe, expect, it } from 'vitest';

import type { ParsedNFe } from '@/lib/documentParsers';
import { buildIngestionReport, createIngestionBatchId } from '@/lib/ingestion/report';
import type { OrtReviewDocument } from '@/lib/ingestion/types';
import type { ValidatedDocument } from '@/lib/ingestionValidator';

type ReportSource = ParsedNFe & { confidence?: number };

function makeSource(overrides: Partial<ReportSource> = {}): ReportSource {
  return {
    invoiceNumber: '100',
    series: '1',
    model: '55',
    accessKey: '1'.repeat(44),
    issueDate: '2026-08-05',
    emitterName: 'Emitente',
    emitterCnpj: '12345678000190',
    recipientName: 'Cliente',
    recipientCnpj: '11222333000144',
    recipientFantasyName: '',
    recipientStateRegistration: '123456789',
    recipientMunicipalRegistration: '987654',
    recipientIeIndicator: '1',
    recipientPhone: '11999999999',
    recipientEmail: 'cliente@example.com',
    recipientCity: 'São Paulo',
    recipientCityCode: '3550308',
    recipientState: 'SP',
    recipientAddress: 'Rua A',
    recipientAddressNumber: '10',
    recipientAddressComplement: '',
    recipientNeighborhood: 'Centro',
    recipientZip: '01001000',
    recipientCountry: 'Brasil',
    recipientCountryCode: '1058',
    items: [],
    totalValue: 100,
    totalWeight: 10,
    totalVolume: 1,
    estimatedPallets: 1,
    clientLoadNumber: '',
    observation: '',
    ...overrides,
  };
}

function makeDocument(overrides: Partial<ValidatedDocument> = {}): ValidatedDocument {
  return {
    source: makeSource(),
    fileName: 'nfe.xml',
    validations: [],
    hasErrors: false,
    hasWarnings: false,
    matchedClientId: 'client-1',
    matchedClientName: 'Cliente',
    isDuplicate: false,
    ...overrides,
  };
}

function makeOrt(overrides: Partial<OrtReviewDocument> = {}): OrtReviewDocument {
  return {
    documentKind: 'ort',
    invoiceNumber: 'ORT-1',
    issueDate: '2026-08-01',
    paymentTerms: '',
    billing: '',
    cargoDescription: 'Mercadoria',
    emitterName: 'Emitente',
    emitterCnpj: '12345678000190',
    recipientName: 'Cliente ORT',
    recipientCnpj: '11222333000144',
    recipientPhone: '',
    recipientCity: 'São Paulo',
    recipientState: 'SP',
    recipientAddress: 'Rua A',
    recipientAddressNumber: '10',
    recipientZip: '01001000',
    recipientNeighborhood: 'Centro',
    totalValue: 100,
    totalWeight: 10,
    totalVolume: 1,
    estimatedPallets: 1,
    productSummary: 'Mercadoria',
    confidence: 0.9,
    needsReview: false,
    fileName: 'ort.pdf',
    ...overrides,
  };
}

const baseArgs = {
  savedCount: 1,
  errorCount: 0,
  autoCreatedCount: 0,
  matchedCount: 1,
  reviewThreshold: 0.82,
};

describe('ingestion report', () => {
  it('gera identificador de lote determinístico a partir do horário informado', () => {
    expect(createIngestionBatchId(new Date('2026-08-24T12:34:56.789Z'))).toBe('ING-20260824123456');
  });

  it('calcula cobertura, pendências e metadados de auditoria', () => {
    const generatedAt = new Date('2026-08-24T12:34:56.789Z');
    const incomplete = makeDocument({
      source: makeSource({
        invoiceNumber: '101',
        issueDate: '2026-08-10',
        recipientCnpj: '',
        recipientStateRegistration: 'UNKNOWN',
        recipientMunicipalRegistration: 'N/I',
        recipientEmail: '',
        recipientAddress: '',
        recipientZip: '',
        recipientCityCode: '123',
        confidence: 0.7,
      }),
      matchedClientId: null,
      matchedClientName: null,
    });

    const report = buildIngestionReport({
      ...baseArgs,
      docs: [makeDocument(), incomplete],
      ortReviewDocs: [],
      autoCreatedCount: 1,
      generatedAt,
      sourceLabel: 'Importação XML',
      tenant: { id: 'tenant-1', name: 'Transportadora' },
      generatedByUserId: 'user-1',
    });
    const coverage = Object.fromEntries(report.fieldCoverage.map((field) => [field.key, field.filled]));

    expect(report).toMatchObject({
      totalDocs: 2,
      needsReviewDocs: 1,
      clientsUnresolved: 0,
      reviewThreshold: 0.82,
    });
    expect(coverage).toEqual({ cnpj: 1, ie: 1, im: 1, email: 1, phone: 2, address: 1, ibge: 1 });
    expect(report.reviewItems).toEqual([expect.objectContaining({
      invoiceNumber: '101',
      confidence: 0.7,
      reasons: [
        'Baixa confiança (70%)',
        'Mapeamento incompleto: CNPJ, IE, endereço, cliente',
      ],
    })]);
    expect(report.auditMeta).toEqual({
      tenantId: 'tenant-1',
      tenantName: 'Transportadora',
      batchId: 'ING-20260824123456',
      sourceLabel: 'Importação XML',
      generatedAt: '2026-08-24T12:34:56.789Z',
      periodFrom: '2026-08-05T00:00:00.000Z',
      periodTo: '2026-08-10T00:00:00.000Z',
      generatedByUserId: 'user-1',
    });
  });

  it('prioriza a revisão ORT e evita duplicar a mesma nota na lista', () => {
    const report = buildIngestionReport({
      ...baseArgs,
      docs: [makeDocument({ source: makeSource({ invoiceNumber: 'ORT-1', confidence: 0.6 }) })],
      ortReviewDocs: [makeOrt({
        confidence: 0.6,
        needsReview: true,
        unknownFields: ['recipientCnpj'],
      })],
      generatedAt: new Date('2026-08-24T00:00:00.000Z'),
    });

    expect(report.needsReviewDocs).toBe(2);
    expect(report.reviewItems).toEqual([{
      invoiceNumber: 'ORT-1',
      fileName: 'ort.pdf',
      recipientName: 'Cliente ORT',
      confidence: 0.6,
      reasons: ['Baixa confiança OCR (60%)', 'Campos não mapeados: recipientCnpj'],
    }]);
  });
});
