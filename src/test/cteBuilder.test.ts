import { describe, it, expect } from 'vitest';
import { buildCtePayload, computeIcmsAmounts, type BuildCtePayloadInput } from '@/lib/fiscal/cteBuilder';
import { buildEmitterExclusiveUse } from '@/lib/fiscal/cteBuilder';

describe('cteBuilder — uso exclusivo do emitente', () => {
  it('consolida seguradora, motorista e observações no campo de uso exclusivo', () => {
    const texto = buildEmitterExclusiveUse({
      insurer: { name: 'AKAD SEGUROS', cnpj: '18.666.510/0001-68', policy: 'AP-1', endorsement: 'CGC-9' },
      insuranceValue: 33.99,
      insuredAmount: 1000,
      driver: { name: 'João', cpf: '123.456.789-01' },
      observations: 'ENTREGA AGENDADA',
    });
    expect(texto).toMatch(/SEGURADORA: AKAD SEGUROS/);
    expect(texto).toMatch(/CNPJ 18666510000168/);
    expect(texto).toMatch(/APOLICE AP-1/);
    expect(texto).toMatch(/AVERBACAO\/CGC CGC-9/);
    expect(texto).toMatch(/MOTORISTA: João - CPF 12345678901/);
    expect(texto).toMatch(/ENTREGA AGENDADA/);
  });

  it('payload leva o texto em observacoes/usoExclusivoEmitente/compl', () => {
    const r = buildCtePayload(baseInput({ observations: 'OBS TESTE' }));
    const p = (r.payload as any).payload;
    expect(p.usoExclusivoEmitente).toMatch(/SEGURADORA: AKAD SEGUROS/);
    expect(p.observacoes).toBe(p.usoExclusivoEmitente);
    expect(p.compl.xObs).toBe(p.usoExclusivoEmitente);
    expect(p.compl.ObsCont[0].xCampo).toBe('USO EXCLUSIVO');
  });
});

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
    insurer: { name: 'AKAD SEGUROS', cnpj: '18666510000168', policy: 'AP-BASE', endorsement: 'AV-BASE' },
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
          cnpj: '18666510000168',
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
    const r = buildCtePayload(baseInput({ insurer: null }));
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

  it('computeIcmsAmounts: embutido faz gross-up do FRETE PESO', () => {
    const r = computeIcmsAmounts({ freight: 154.83, aliq: 18, embutido: true, isento: false });
    expect(r.base).toBeCloseTo(188.82, 2);
    expect(r.valor).toBeCloseTo(33.99, 2);
    // FRETE A RECEBER = FRETE PESO + ICMS
    expect(154.83 + r.valor).toBeCloseTo(r.base, 2);
  });

  it('computeIcmsAmounts: isento zera mesmo com embutido=true', () => {
    const r = computeIcmsAmounts({ freight: 1000, aliq: 12, embutido: true, isento: true });
    expect(r.base).toBe(0);
    expect(r.valor).toBe(0);
  });

  it('computeIcmsAmounts: embutido mantém a base fiscal informada', () => {
    const r = computeIcmsAmounts({
      freight: 3583.74,
      aliq: 5.35,
      embutido: true,
      isento: false,
      providedBase: 3583.74,
      providedValor: 191.73,
    });
    expect(r.base).toBeCloseTo(3583.74, 2);
    expect(r.valor).toBeCloseTo(191.73, 2);
  });

  it('buildCtePayload: embutido=true soma ICMS ao FRETE PESO', () => {
    const input: BuildCtePayloadInput = {
      emitter: { id: 'em1', cnpj: '18666510000168', name: 'X', environment: 'sandbox' },
      remitter: { name: 'R', cnpj: '14998371003215' },
      recipient: { name: 'D', cnpj: '07734610000168' },
      takerRole: 'destinatario',
      driver: null,
      vehicle: null,
      nature: 'PRESTACAO',
      invoices: [{ access_key: '3'.repeat(44), number: '1', series: '1', value: 100 }],
      totals: { freight_value: 154.83, cargo_value: 100, weight_kg: 1, pallet_count: 0 },
      icms: { cst: '00', aliquota: 18, embutido: true },
      insurer: { name: 'AKAD', cnpj: '18666510000168', policy: 'AP-1', endorsement: 'AV-1' },
    };
    const r = buildCtePayload(input);
    expect(r.ok).toBe(true);
    const icms = (r.payload as any).payload.icms;
    expect(icms.embutido).toBe(true);
    expect(icms.indICMS).toBe(1);
    expect(icms.vBC).toBeCloseTo(188.82, 2);
    expect(icms.vICMS).toBeCloseTo(33.99, 2);
    expect(icms.pICMS).toBeCloseTo(18, 2);
    const p = (r.payload as any).payload;
    expect(p.valores.valorFreteBase).toBe(154.83);
    expect(p.valores.valorTotalServico).toBe(188.82);
    expect(p.valores.valorReceber).toBe(188.82);
    expect(p.valorPrestacao.Comp).toEqual([
      { xNome: 'FRETE PESO', vComp: 154.83 },
      { xNome: 'ICMS', vComp: 33.99 },
    ]);
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

  it('buildCtePayload: por fora destaca ICMS sem somar ao valor a receber', () => {
    const input: BuildCtePayloadInput = {
      emitter: { id: 'em1', cnpj: '18666510000168', name: 'X', environment: 'sandbox' },
      remitter: { name: 'R', cnpj: '14998371003215' },
      recipient: { name: 'D', cnpj: '07734610000168' },
      takerRole: 'destinatario',
      driver: null,
      vehicle: null,
      nature: 'PRESTACAO',
      invoices: [{ access_key: '3'.repeat(44), number: '1', series: '1', value: 100 }],
      totals: { freight_value: 1000, cargo_value: 100, weight_kg: 1, pallet_count: 0 },
      icms: { cst: '00', aliquota: 12, embutido: false },
      insurer: { name: 'AKAD', cnpj: '18666510000168', policy: 'AP-1', endorsement: 'AV-1' },
    };
    const p = (buildCtePayload(input).payload as any).payload;
    expect(p.valores.valorFreteBase).toBe(1000);
    expect(p.valores.valorIcms).toBeCloseTo(120, 2);
    // ICMS por fora NÃO entra no total a receber
    expect(p.valores.valorReceber).toBe(1000);
    expect(p.valores.valorTotalServico).toBe(1000);
    // mas continua destacado nos componentes com soma=false
    expect(p.componentes).toEqual([
      { nome: 'FRETE PESO', valor: 1000, soma: true },
      { nome: 'ICMS', valor: 120, soma: false },
    ]);
    // e fora do grupo Comp para fechar com vTPrest
    expect(p.valorPrestacao.Comp).toEqual([{ xNome: 'FRETE PESO', vComp: 1000 }]);
  });
});

describe('cteBuilder — regime tributário do emitente', () => {
  it('emitente sem regime cadastrado assume normal (CRT 3) e avisa', () => {
    const r = buildCtePayload(baseInput({ icms: { cst: '00', aliquota: 12, embutido: true } }));
    const p = (r.payload as any).payload;
    expect(p.crt).toBe(3);
    expect(p.icms.crt).toBe(3);
    expect(p.icms.regime).toBe('normal');
    expect(r.warnings.join(' ')).toMatch(/Regime tributário do emitente/i);
  });

  it('emitente Simples Nacional envia CRT 1 e regime simples', () => {
    const base = baseInput({ icms: { cst: '00', aliquota: 12, embutido: true } });
    const r = buildCtePayload({
      ...base,
      emitter: { ...base.emitter!, taxRegime: 'simples' },
    });
    const p = (r.payload as any).payload;
    expect(p.crt).toBe(1);
    expect(p.icms.crt).toBe(1);
    expect(p.icms.regime).toBe('simples');
  });

  it('emitente Lucro Real envia CRT 3', () => {
    const base = baseInput({ icms: { cst: '00', aliquota: 12, embutido: true } });
    const r = buildCtePayload({
      ...base,
      emitter: { ...base.emitter!, taxRegime: 'real' },
    });
    expect((r.payload as any).payload.crt).toBe(3);
    expect((r.payload as any).payload.icms.regime).toBe('normal');
  });
});
describe('cteBuilder — componentes do valor da prestação', () => {
  it('sempre inclui FRETE PESO e ICMS, e SEGURO quando cobrado', () => {
    const r = buildCtePayload(
      baseInput({
        totals: { freight_value: 188.82, cargo_value: 1000, weight_kg: 10, pallet_count: 0 },
        freightComposition: { insurance_value: 33.99 } as any,
        icms: { cst: '00', aliquota: 12, embutido: false },
        insurer: { name: 'AKAD', cnpj: '18666510000168', policy: '123456', endorsement: 'AV-9' },
      }),
    );
    const p = (r.payload as any).payload;
    const nomes = p.componentes.map((c: any) => c.nome);
    expect(nomes).toContain('FRETE PESO');
    expect(nomes).toContain('SEGURO');
    expect(nomes).toContain('ICMS');
    expect(p.seguradora.valorSeguro).toBe(33.99);
    expect(p.seguradora.valorSegurado).toBe(1000);
    expect(p.seguro.nApol).toBe('123456');
    expect(p.seguro.nAver).toEqual(['AV-9']);
    expect(p.seguros).toHaveLength(1);
  });

  it('bloqueia emissão quando não há seguradora informada', () => {
    const r = buildCtePayload(baseInput({ insurer: null }));
    expect(r.ok).toBe(false);
    expect(r.missing.join(' ')).toMatch(/Seguradora é obrigatória/i);
    expect(r.missing.join(' ')).toMatch(/CNPJ da seguradora é obrigatório/i);
    expect(r.missing.join(' ')).toMatch(/apólice é obrigatório/i);
    expect(r.missing.join(' ')).toMatch(/averbação é obrigatório/i);
  });

  it('bloqueia emissão quando CNPJ/apólice/averbação estão em formato inválido', () => {
    const r = buildCtePayload(
      baseInput({ insurer: { name: 'AKAD', cnpj: '11111111111111', policy: 'A', endorsement: '@@' } }),
    );
    expect(r.ok).toBe(false);
    expect(r.missing.join(' ')).toMatch(/CNPJ da seguradora inválido/i);
    expect(r.missing.join(' ')).toMatch(/apólice inválido/i);
    expect(r.missing.join(' ')).toMatch(/averbação inválido/i);
  });
});

describe('cteBuilder — campos aceitos pela API v1 do Hub', () => {
  it('envia CFOP, dhEmi, inicio/fim, mercadoria e aliases de ICMS/valores', () => {
    const r = buildCtePayload(
      baseInput({
        cfop: '6352',
        issueDate: '2026-07-31',
        series: '1',
        number: 21,
        rntrc: '12345678',
        icms: { cst: '00', aliquota: 12, embutido: true },
        cargo: { content: 'CONFORME NF', species: 'CAIXAS', predominant_product: 'ALIMENTOS' },
      }),
    );
    const p = (r.payload as any).payload;
    expect(p.CFOP).toBe('6352');
    expect(p.dhEmi).toBe('2026-07-31');
    expect(p.serie).toBe('1');
    expect(p.numero).toBe('21');
    expect(p.veiculo.rntrc).toBe('12345678');
    expect(p.modalRodoviario.rntrc).toBe('12345678');
    expect(p.valores.baseIcms).toBeGreaterThan(0);
    expect(p.valores.aliquotaIcms).toBe(12);
    expect(p.icms.baseCalculo).toBe(p.icms.vBC);
    expect(Object.keys(p.mercadoria).sort()).toEqual(['content', 'produto', 'species']);
    expect(p.notasFiscais[0].chaveNFe).toBe(p.notasFiscais[0].chave);
  });

  it('inclui motDesICMS quando isento e valorAverbacao no seguro', () => {
    const r = buildCtePayload(baseInput({ icms: { cst: '40', isento: true, aliquota: 0 } }));
    const p = (r.payload as any).payload;
    expect(p.icms.motDesICMS).toBeDefined();
    expect(p.seguro.valorAverbacao).toBeDefined();
    expect(p.seguro.seguradora).toBeDefined();
  });
});


describe('recipient contributor IE validation', () => {
  it.each([null, '', 'UNKNOWN', '12345', 'ISENTO'])('blocks a registered contributor with IE %s before dispatch', ie => {
    const result = buildCtePayload(baseInput({recipient: {name: 'Contribuinte QA', cnpj: '11222333000181', ie, ieIndicator: 'Contribuinte ICMS', address: {state: 'MG'}}}));
    expect(result.ok).toBe(false);
    expect(result.missing.join(' ')).toContain('IE válida do destinatário');
  });
  it('accepts an explicit valid-length IE correction preserving leading zeroes', () => {
    const result = buildCtePayload(baseInput({recipient: {name: 'Contribuinte QA', cnpj: '11222333000181', ie: null, ieIndicator: 'Contribuinte ICMS', address: {state: 'MG'}}, overrides: {recipient: {ie: '0012345678901'}}}));
    expect(result.ok).toBe(true);
    expect(result.payload).toMatchObject({payload: {destinatario: {ie: '0012345678901'}}});
  });
  it('does not impose a contributor IE on a registered non-contributor', () => {
    const result = buildCtePayload(baseInput({recipient: {name: 'Nao contribuinte QA', cnpj: '11222333000181', ie: null, ieIndicator: 'Não Contribuinte'}}));
    expect(result.ok).toBe(true);
  });
});
