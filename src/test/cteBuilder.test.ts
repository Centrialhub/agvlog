import { describe, it, expect } from 'vitest';
import { buildCtePayload, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';

function baseInput(overrides: Partial<BuildCtePayloadInput> = {}): BuildCtePayloadInput {
  return {
    emitter: {
      id: 'em1',
      cnpj: '18666510000168',
      name: 'LIRA EMPREENDIMENTOS',
      environment: 'sandbox',
    },
    remitter: { name: 'JMacedo', cnpj: '14998371003215' },
    recipient: { name: 'COMERCIAL GALA', cnpj: '07734610000168' },
    takerRole: 'destinatario',
    driver: null,
    vehicle: null,
    nature: 'PRESTACAO DE SERVICO DE TRANSPORTE',
    invoices: [{ access_key: '3'.repeat(44), number: '55679', series: '2', value: 282.96 }],
    totals: { freight_value: 10.35, cargo_value: 282.96, weight_kg: 0.68, pallet_count: 0 },
    ...overrides,
  };
}

describe('cteBuilder — motorista/placa opcionais', () => {
  it('preenche motorista/placa com "." quando ausentes e não bloqueia', () => {
    const r = buildCtePayload(baseInput());
    expect(r.missing).not.toContain('Motorista');
    expect(r.missing).not.toContain('Veículo (placa)');
    expect(r.ok).toBe(true);
    const p = (r.payload as any).payload;
    expect(p.motorista.nome).toBe('.');
    expect(p.veiculo.placa).toBe('.');
    expect(r.warnings.join(' ')).toMatch(/Motorista não informado/i);
    expect(r.warnings.join(' ')).toMatch(/Veículo/i);
  });

  it('usa motorista/placa reais quando informados', () => {
    const r = buildCtePayload(
      baseInput({
        driver: { name: 'João', cpf: '12345678901' },
        vehicle: { plate: 'gvj9909', state: 'MG' },
      }),
    );
    const p = (r.payload as any).payload;
    expect(p.motorista.nome).toBe('João');
    expect(p.veiculo.placa).toBe('GVJ9909');
  });
});

describe('cteBuilder — novos blocos', () => {
  it('serializa seguradora, tipo CTRC, carretas e composição de frete', () => {
    const r = buildCtePayload(
      baseInput({
        documentType: '01',
        vehicleType: '01',
        vehicle: { plate: 'ABC1D23' },
        additionalPlates: ['xyz1a11', 'xyz1a22'],
        insurer: {
          name: 'AKAD SEGUROS',
          policy: '2798202301065400079',
          endorsement: '123',
        },
        freightComposition: { freight_weight: 8.49, toll: 0, gris: 0, dispatch: 0 },
        icms: { embutido: true, aliquota: 18, base: 10.35, valor: 1.86 },
        cbsIbs: { base: 8.18, cbs_aliquota: 0.9, cbs_valor: 0.07, ibs_aliquota: 0.1, ibs_valor: 0.01 },
        cargo: { content: 'CONFORME NF', species: 'CONFORME NF', predominant_product: 'REP PONTAS' },
      }),
    );
    const p = (r.payload as any).payload;
    expect(p.tipoCtrc).toBe('01');
    expect(p.veiculo.tipo).toBe('01');
    expect(p.veiculo.carretas).toEqual(['XYZ1A11', 'XYZ1A22']);
    expect(p.seguradora.nome).toBe('AKAD SEGUROS');
    expect(p.seguradora.apolice).toBe('2798202301065400079');
    expect(p.composicaoFrete.freight_weight).toBe(8.49);
    expect(p.icms.aliquota).toBe(18);
    expect(p.cbsIbs.cbs_aliquota).toBe(0.9);
    expect(p.mercadoria.content).toBe('CONFORME NF');
  });

  it('omite blocos vazios (undefined) do payload', () => {
    const r = buildCtePayload(baseInput());
    const p = (r.payload as any).payload;
    expect(p.seguradora).toBeUndefined();
    expect(p.composicaoFrete).toBeUndefined();
    expect(p.icms).toBeUndefined();
    expect(p.mercadoria).toBeUndefined();
    expect(p.veiculo.carretas).toBeUndefined();
  });
});