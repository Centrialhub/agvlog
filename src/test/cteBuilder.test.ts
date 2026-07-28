import { describe, it, expect } from 'vitest';
import { buildCtePayload, computeIcmsAmounts, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';

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

describe('cteBuilder — ICMS embutido (por dentro)', () => {
  it('computeIcmsAmounts: por fora usa base = frete', () => {
    const r = computeIcmsAmounts({ freight: 3583.74, aliq: 5.35, embutido: false, isento: false });
    expect(r.base).toBeCloseTo(3583.74, 2);
    expect(r.valor).toBeCloseTo(191.73, 2);
  });

  it('computeIcmsAmounts: embutido faz gross-up da base', () => {
    const r = computeIcmsAmounts({ freight: 3583.74, aliq: 5.35, embutido: true, isento: false });
    // 3583.74 / (1 - 0.0535) ≈ 3786.31
    expect(r.base).toBeCloseTo(3786.31, 1);
    expect(r.valor).toBeCloseTo(202.57, 1);
  });

  it('computeIcmsAmounts: isento zera mesmo com embutido=true', () => {
    const r = computeIcmsAmounts({ freight: 1000, aliq: 12, embutido: true, isento: true });
    expect(r.base).toBe(0);
    expect(r.valor).toBe(0);
  });

  it('computeIcmsAmounts: embutido ignora providedBase quando é o "frete cru" (bug antigo)', () => {
    const r = computeIcmsAmounts({
      freight: 3583.74,
      aliq: 5.35,
      embutido: true,
      isento: false,
      providedBase: 3583.74,
      providedValor: 191.73,
    });
    expect(r.base).toBeCloseTo(3786.31, 1);
    expect(r.valor).toBeCloseTo(202.57, 1);
  });

  it('buildCtePayload: embutido=true gera vBC grossed-up no bloco icms', () => {
    const input: BuildCtePayloadInput = {
      emitter: { id: 'em1', cnpj: '18666510000168', name: 'X', environment: 'sandbox' },
      remitter: { name: 'R', cnpj: '14998371003215' },
      recipient: { name: 'D', cnpj: '07734610000168' },
      takerRole: 'destinatario',
      driver: null,
      vehicle: null,
      nature: 'PRESTACAO',
      invoices: [{ access_key: '3'.repeat(44), number: '1', series: '1', value: 100 }],
      totals: { freight_value: 3583.74, cargo_value: 100, weight_kg: 1, pallet_count: 0 },
      icms: { cst: '00', aliquota: 5.35, base: 3583.74, valor: 191.73, embutido: true },
    };
    const r = buildCtePayload(input);
    expect(r.ok).toBe(true);
    const icms = (r.payload as any).payload.icms;
    expect(icms.embutido).toBe(true);
    expect(icms.indICMS).toBe(1);
    expect(icms.vBC).toBeCloseTo(3786.31, 1);
    expect(icms.vICMS).toBeCloseTo(202.57, 1);
    expect(icms.pICMS).toBeCloseTo(5.35, 2);
  });

  it('buildCtePayload: por fora mantém vBC = frete', () => {
    const input: BuildCtePayloadInput = {
      emitter: { id: 'em1', cnpj: '18666510000168', name: 'X', environment: 'sandbox' },
      remitter: { name: 'R', cnpj: '14998371003215' },
      recipient: { name: 'D', cnpj: '07734610000168' },
      takerRole: 'destinatario',
      driver: null,
      vehicle: null,
      nature: 'PRESTACAO',
      invoices: [{ access_key: '3'.repeat(44), number: '1', series: '1', value: 100 }],
      totals: { freight_value: 3583.74, cargo_value: 100, weight_kg: 1, pallet_count: 0 },
      icms: { cst: '00', aliquota: 5.35, embutido: false },
    };
    const r = buildCtePayload(input);
    const icms = (r.payload as any).payload.icms;
    expect(icms.embutido).toBe(false);
    expect(icms.indICMS).toBe(0);
    expect(icms.vBC).toBeCloseTo(3583.74, 2);
    expect(icms.vICMS).toBeCloseTo(191.73, 2);
  });
});