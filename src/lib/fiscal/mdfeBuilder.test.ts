import { buildMdfePayload, BuildMdfePayloadInput } from './mdfeBuilder';

interface MdfePayloadUnderTest {
  modalidadeDeTransporte: string;
  produtoPredominante: { descricao: string };
  ide: { natureza: string };
  emit: { cnpj: string };
  tot: { vCarga: number; cUnid: string; qCarga: number };
  infModal: {
    rodo: {
      veicTracao: { placa: string };
      condutor: Array<{ CPF: string }>;
      infANTT: {
        RNTRC: string;
        infCIOT: Array<{ CIOT: string; CNPJ?: string; CPF?: string }>;
        infContratante: Array<{ CNPJ?: string; CPF?: string; xNome: string; enderContratante?: unknown }>;
      };
    };
  };
  infDoc: {
    infMunDescarga: Array<{
      cMunDescarga: string;
      infCTe: Array<{ chCTe: string }>;
    }>;
  };
  descarregamento: Array<{
    municipio: { codigoIBGE: string; nome: string };
    ctes: Array<{ chave: string }>;
    nfes: Array<{ chave: string }>;
  }>;
  seg: Array<{ nAver: string[]; nAv: string[] }>;
}

describe('mdfeBuilder', () => {
  const mockInput: BuildMdfePayloadInput = {
    emitter: {
      cnpj: '12345678000190',
      name: 'AGV LOGISTICA',
      environment: 'sandbox',
    },
    driver: {
      name: 'JOAO MOTORISTA',
      cpf: '123.456.789-00',
    },
    vehicle: {
      plate: 'ABC1D23',
      state: 'SP',
      rntrc: '12345678',
      tara: 15000,
    },
    origin: {
      city_ibge: '3550308',
      city_name: 'SAO PAULO',
      state: '35',
    },
    destination: {
      city_ibge: '4106902',
      city_name: 'CURITIBA',
      state: 'PR',
    },
    documents: [
      { key: '35260812345678000190570010000000011000000010', type: 'cte' }
    ],
    insurance: {
      providerName: 'SEGURADORA TESTE',
      providerCnpj: '12345678000190',
      policyNumber: 'APOLICE-1001',
      endorsementNumbers: ['AV-1001'],
    },
    ciot: {
      number: '123456789012',
      responsibleDoc: '11222333000181',
    },
    valCarga: 50000,
    pesoBruto: 3682.63,
    predominantProduct: 'CAIXAS DE PAPELAO',
    nature: 'VENDA DE SERVICO',
    observations: 'MDF-E DE TESTE',
    externalId: 'TRIP-1001'
  };

  it('should build a valid MDFe payload', () => {
    const result = buildMdfePayload(mockInput);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.payload.emitterCnpj).toBe('12345678000190');
    
    const inner = result.payload.payload as unknown as MdfePayloadUnderTest;
    expect(inner.ide.natureza).toBe('VENDA DE SERVICO');
    expect(inner.modalidadeDeTransporte).toBe('1');
    expect(inner.produtoPredominante).toEqual({ descricao: 'CAIXAS DE PAPELAO' });
    expect(inner.emit.cnpj).toBe('12345678000190');
    expect(inner.infModal.rodo.veicTracao.placa).toBe('ABC1D23');
    expect(inner.infModal.rodo.condutor[0].CPF).toBe('12345678900');
    expect(inner.infModal.rodo.infANTT.RNTRC).toBe('12345678');
    expect(inner.infModal.rodo.infANTT.infCIOT).toEqual([
      { CIOT: '123456789012', CNPJ: '11222333000181' },
    ]);
    expect(inner.tot).toMatchObject({ vCarga: 50000, cUnid: '01', qCarga: 3682.63 });
    expect(inner.seg[0].nAver).toEqual(['AV-1001']);
    expect(inner.seg[0].nAv).toEqual(['AV-1001']);
    expect(inner.infDoc.infMunDescarga[0].cMunDescarga).toBe('4106902');
    expect(inner.infDoc.infMunDescarga[0].infCTe[0].chCTe).toBe('35260812345678000190570010000000011000000010');
    expect(inner.descarregamento[0].municipio.codigoIBGE).toBe('4106902');
    expect(inner.descarregamento[0].ctes[0].chave).toBe('35260812345678000190570010000000011000000010');
    expect(inner.descarregamento[0].nfes).toEqual([]);
  });

  it('should return missing fields when required data is absent', () => {
    const invalidInput: BuildMdfePayloadInput = { ...mockInput, vehicle: { plate: '', state: '' } };
    const result = buildMdfePayload(invalidInput);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Placa do veículo');
  });

  it('rejects incomplete driver, route and toll-voucher data', () => {
    const result = buildMdfePayload({
      ...mockInput,
      driver: { name: '', cpf: '123' },
      origin: { city_ibge: '123', city_name: '', state: 'SP' },
      valePedagio: { cnpjFornecedor: '123', numeroComprovante: '', valor: 0 },
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      'Nome do motorista',
      'CPF válido do motorista',
      'Cidade de origem (IBGE)',
      'Nome da cidade de origem',
      'Código IBGE da UF de origem',
      'CNPJ válido do fornecedor do vale-pedágio',
      'Número do comprovante do vale-pedágio',
      'Valor do vale-pedágio',
    ]));
  });

  it('groups documents by unloading city', () => {
    const result = buildMdfePayload({
      ...mockInput,
      documents: [
        {
          key: '35260812345678000190570010000000011000000010',
          type: 'cte',
          destination: { city_ibge: '4106902', city_name: 'CURITIBA', state: 'PR' },
        },
        {
          key: '35260812345678000190550010000000021000000020',
          type: 'nfe',
          destination: { city_ibge: '4205407', city_name: 'FLORIANOPOLIS', state: 'SC' },
        },
      ],
    });

    expect(result.ok).toBe(true);
    const inner = result.payload.payload as unknown as MdfePayloadUnderTest;
    expect(inner.infDoc.infMunDescarga).toHaveLength(2);
    expect(inner.descarregamento).toEqual([
      {
        municipio: { codigoIBGE: '4106902', nome: 'CURITIBA' },
        ctes: [{ chave: '35260812345678000190570010000000011000000010' }],
        nfes: [],
      },
      {
        municipio: { codigoIBGE: '4205407', nome: 'FLORIANOPOLIS' },
        ctes: [],
        nfes: [{ chave: '35260812345678000190550010000000021000000020' }],
      },
    ]);
  });

  it('serializes the actual CPF taker and omits an incomplete optional address', () => {
    const result = buildMdfePayload({
      ...mockInput,
      takers: [{
        document: '12345678900',
        name: 'TOMADOR PESSOA FISICA',
        ie: 'ISENTO',
        address: { street: 'Rua sem cadastro completo', city_name: 'Campinas' },
      }],
      documents: [{
        ...mockInput.documents[0],
        insuranceEndorsements: ['AV-CTE-1'],
      }],
    });

    expect(result.ok).toBe(true);
    const inner = result.payload.payload as unknown as MdfePayloadUnderTest;
    expect(inner.infModal.rodo.infANTT.infContratante).toEqual([{
      xNome: 'TOMADOR PESSOA FISICA',
      CPF: '12345678900',
      IE: 'ISENTO',
    }]);
    expect(inner.seg[0].nAv).toEqual(['AV-1001', 'AV-CTE-1']);
  });

  it('blocks transport emission without CIOT, RNTRC, cargo totals and endorsements', () => {
    const result = buildMdfePayload({
      ...mockInput,
      vehicle: { ...mockInput.vehicle, rntrc: '' },
      ciot: null,
      valCarga: 0,
      pesoBruto: 0,
      predominantProduct: '',
      insurance: { ...mockInput.insurance!, endorsementNumbers: [] },
      documents: mockInput.documents.map(document => ({ ...document, insuranceEndorsements: [] })),
    });

    expect(result.ok).toBe(false);
    expect(result.missing).toEqual(expect.arrayContaining([
      'RNTRC válido do transportador (8 dígitos)',
      'CIOT válido (12 dígitos)',
      'CPF/CNPJ do responsável pelo CIOT',
      'Valor total da carga',
      'Peso bruto total da carga',
      'Descrição do produto predominante',
      'Número de averbação do seguro',
    ]));
  });
});
