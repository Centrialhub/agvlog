import { describe, it, expect } from 'vitest';
import { generateDoccob } from '../doccobGenerator';
import { parseDoccobFile, trailerTotalReais } from '../doccobParser';

const input: any = {
  carrier: { cnpj: '12345678000190', name: 'AGV TRANSPORTES' },
  profile: { destinationName: 'CLARA', layoutVersion: 'SIAT_CTMS_DOCCOB_SAMPLE_2026' },
  generatedAt: new Date(Date.UTC(2026, 6, 2, 9, 27)),
  invoices: [
    {
      id: 'i1',
      invoiceNumber: '944/01',
      issueDate: '2026-05-19',
      dueDate: '2026-06-19',
      totalAmount: 15285.25,
      clientName: 'CLIENTE TESTE',
      clientTaxId: '98765432000110',
      charges: [
        {
          id: 'c1', sourceType: 'cte_document', sourceNumber: '1', grossAmount: 15285.25,
          issueDate: '2026-05-19',
          details: [{ id: 'd1', chargeId: 'c1', documentNumber: 'NF1', emissionDate: '2026-05-18', cargoValue: 15285.25 }],
        },
      ],
    },
  ],
};

describe('parseDoccobFile', () => {
  it('reconhece registros 000/350/351/352/353/354/355', () => {
    const res = generateDoccob(input);
    const parsed = parseDoccobFile(res.content);
    expect(parsed.header).not.toBeNull();
    expect(parsed.identification).not.toBeNull();
    expect(parsed.carrier).not.toBeNull();
    expect(parsed.invoices).toHaveLength(1);
    expect(parsed.invoices[0].charges).toHaveLength(1);
    expect(parsed.invoices[0].charges[0].details).toHaveLength(1);
    expect(parsed.trailer).not.toBeNull();
  });

  it('trailer total corresponde a R$ 15.285,25', () => {
    const res = generateDoccob(input);
    const parsed = parseDoccobFile(res.content);
    expect(trailerTotalReais(parsed)).toBe(15285.25);
  });

  it('não gera warnings quando arquivo é válido', () => {
    const res = generateDoccob(input);
    const parsed = parseDoccobFile(res.content);
    expect(parsed.validationWarnings).toEqual([]);
  });
});