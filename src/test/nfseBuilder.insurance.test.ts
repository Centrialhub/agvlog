import { describe, it, expect } from 'vitest';
import { buildNFSeEmitPayload } from '@/lib/fiscal/nfseBuilder';
import { buildInsuranceText, hasInsuranceData } from '@/lib/fiscal/insuranceText';

const emitter: any = {
  cnpj: '11222333000181', razao_social: 'AGV Log', im: '123', ie: '456',
  city_code: '3106200', endereco: { uf: 'MG', municipio: 'Janauba' },
};
const baseDoc: any = {
  id: 'doc-1', cliente_cnpj: '11222333000181', cliente_nome: 'Cliente X',
  valor_servicos: 100, aliquota_iss: 5, issue_date: '2026-07-31', rps_number: '10',
  description: 'Frete de transporte',
};
const ins = {
  insurer_name: 'Seguradora Brasil', insurer_cnpj: '11222333000181',
  insurer_policy: 'AP-2026-001', insurer_endorsement: 'AV-99881',
  insured_amount: 50000, insurance_premium: 120.5,
};

describe('NFS-e — propagação do seguro', () => {
  it('não emite bloco de seguro quando não há dados', () => {
    const { payload } = buildNFSeEmitPayload({ doc: baseDoc, emitter });
    expect((payload as any).seguro).toBeUndefined();
    expect(payload.servico.discriminacao).toBe('Frete de transporte');
  });

  it('propaga seguradora, apólice, averbação e valores', () => {
    const { payload } = buildNFSeEmitPayload({ doc: { ...baseDoc, ...ins }, emitter });
    expect((payload as any).seguro).toMatchObject({
      seguradora: 'Seguradora Brasil',
      cnpjSeguradora: '11222333000181',
      apolice: 'AP-2026-001',
      averbacao: 'AV-99881',
      valorSegurado: 50000,
      valorSeguro: 120.5,
    });
  });

  it('imprime os dados do seguro na discriminação e na observação', () => {
    const { payload } = buildNFSeEmitPayload({ doc: { ...baseDoc, ...ins, notes: 'obs' }, emitter });
    expect(payload.servico.discriminacao).toContain('Apólice: AP-2026-001');
    expect(payload.servico.discriminacao).toContain('Averbação: AV-99881');
    expect(payload.servico.discriminacao).toContain('Seguradora: Seguradora Brasil');
    expect((payload as any).observacao).toContain('Averbação: AV-99881');
  });

  it('bloqueia emissão com seguro incompleto/inválido', () => {
    expect(() => buildNFSeEmitPayload({ doc: { ...baseDoc, insurer_policy: 'AP-1' }, emitter }))
      .toThrow(/Dados do seguro inválidos/);
  });

  it('helpers de texto', () => {
    expect(hasInsuranceData(null)).toBe(false);
    expect(buildInsuranceText(ins)).toContain('Valor segurado: R$ 50.000,00');
  });
});
