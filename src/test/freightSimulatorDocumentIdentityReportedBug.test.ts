import { describe, expect, it } from 'vitest';
import { deduplicateFreightDocuments, freightDocumentIdentity } from '@/lib/freight/freightSimulatorDocuments';

describe('identidade fiscal no simulador de frete', () => {
  it('preserva documentos distintos quando chave, número e emitente estão ausentes', () => {
    const documents = [
      { id: 'doc-a', access_key: null, invoice_number: null, remitter: null, document_type: 'inbound' },
      { id: 'doc-b', access_key: null, invoice_number: null, remitter: null, document_type: 'inbound' },
    ];

    expect(documents.map(freightDocumentIdentity)).toEqual(['id:doc-a', 'id:doc-b']);
    expect(deduplicateFreightDocuments(documents)).toEqual(documents);
  });

  it('ainda consolida uma duplicata real e conserva a versão mais recente', () => {
    const older = { id: 'old', access_key: ' 123 ', created_at: '2026-09-01T00:00:00Z' };
    const newer = { id: 'new', access_key: '123', created_at: '2026-09-02T00:00:00Z' };
    expect(deduplicateFreightDocuments([older, newer])).toEqual([newer]);
  });
});
