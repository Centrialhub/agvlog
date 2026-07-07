import { describe, it, expect } from 'vitest';
import { generateDoccob } from '../doccobGenerator';
import { DOCCOB_LINE_LENGTHS } from '../doccobTypes';

const baseInput = () => ({
  carrier: { cnpj: '12.345.678/0001-90', name: 'AGV Transportes LTDA' },
  profile: {
    destinationName: 'CLARA SISTEMAS',
    companyCode: 'AGV',
    branchCode: 'MOC',
    documentType: 'FAT',
    bankName: 'BANCO DO BRASIL',
    bankAgency: '1234',
    bankAccount: '56789-0',
    layoutVersion: 'SIAT_CTMS_DOCCOB_SAMPLE_2026',
  },
  generatedAt: new Date(Date.UTC(2026, 6, 2, 9, 27)),
  invoices: [
    {
      id: 'inv-1',
      invoiceNumber: '944/01',
      issueDate: '2026-05-19',
      dueDate: '2026-06-19',
      totalAmount: 15285.25,
      clientName: 'CLIENTE EXEMPLO S/A',
      clientTaxId: '98.765.432/0001-10',
      paymentMethod: 'BOLETO',
      charges: [
        {
          id: 'ch-1',
          sourceType: 'cte_document',
          sourceNumber: '123456',
          sourceSeries: '1',
          referenceNumber: '944-01',
          issueDate: '2026-05-19',
          grossAmount: 10285.25,
          description: 'CT-e principal',
          carrierCnpj: '12345678000190',
          details: [
            { id: 'd1', chargeId: 'ch-1', documentNumber: '1001', emissionDate: '2026-05-18', cargoValue: 5000, weightKg: 120 },
            { id: 'd2', chargeId: 'ch-1', documentNumber: '1002', emissionDate: '2026-05-18', cargoValue: 5285.25, weightKg: 130 },
          ],
        },
        {
          id: 'ch-2',
          sourceType: 'nfse_document',
          sourceNumber: '78',
          issueDate: '2026-05-20',
          grossAmount: 5000,
          carrierCnpj: '12345678000190',
          details: [{ id: 'd3', chargeId: 'ch-2', documentNumber: 'NFSe-78', emissionDate: '2026-05-20', cargoValue: 5000 }],
        },
      ],
    },
  ],
});

describe('generateDoccob', () => {
  it('gera arquivo com registros na ordem correta e CRLF', () => {
    const res = generateDoccob(baseInput() as any);
    const lines = res.content.split('\r\n').filter(Boolean);
    const types = lines.map((l) => l.slice(0, 3));
    expect(types[0]).toBe('000');
    expect(types[1]).toBe('350');
    expect(types[2]).toBe('351');
    expect(types).toContain('352');
    expect(types).toContain('353');
    expect(types).toContain('354');
    expect(types[types.length - 1]).toBe('355');
    expect(res.content.endsWith('\r\n')).toBe(true);
  });

  it('respeita comprimento de linha por tipo de registro', () => {
    const res = generateDoccob(baseInput() as any);
    for (const line of res.content.split('\r\n').filter(Boolean)) {
      const type = line.slice(0, 3) as keyof typeof DOCCOB_LINE_LENGTHS;
      expect(line.length).toBe(DOCCOB_LINE_LENGTHS[type]);
    }
    expect(res.lengthWarnings).toEqual([]);
  });

  it('não duplica valor de frete quando charge tem várias NFs', () => {
    const res = generateDoccob(baseInput() as any);
    expect(res.totalAmount).toBe(15285.25);
    expect(res.chargeCount).toBe(2);
    expect(res.detailCount).toBe(3);
  });

  it('bloqueia charge sem details a menos que perfil autorize', () => {
    const input = baseInput() as any;
    input.invoices[0].charges[0].details = [];
    expect(() => generateDoccob(input)).toThrow();
    input.profile.allowChargeWithoutDetails = true;
    const res = generateDoccob(input);
    expect(res.detailCount).toBe(1);
  });

  it('trailer contém total em centavos correto', () => {
    const res = generateDoccob(baseInput() as any);
    const trailer = res.content.split('\r\n').filter(Boolean).pop()!;
    // total field: chars 9..24 => 15 dígitos, 15285.25 => 1528525 cents
    const cents = parseInt(trailer.slice(9, 24), 10);
    expect(cents).toBe(1528525);
  });
});