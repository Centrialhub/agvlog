import { buildMdfePayload, BuildMdfePayloadInput } from './mdfeBuilder';

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
      state: 'SP',
    },
    destination: {
      city_ibge: '4106902',
      city_name: 'CURITIBA',
      state: 'PR',
    },
    documents: [
      { key: '35260812345678000190570010000000011000000010', type: 'cte' }
    ],
    nature: 'VENDA DE SERVICO',
    observations: 'MDF-E DE TESTE',
    externalId: 'TRIP-1001'
  };

  it('should build a valid MDFe payload', () => {
    const result = buildMdfePayload(mockInput);
    expect(result.ok).toBe(true);
    expect(result.missing).toHaveLength(0);
    expect(result.payload.emitterCnpj).toBe('12345678000190');
    
    const inner = (result.payload.payload as any);
    expect(inner.ide.natureza).toBe('VENDA DE SERVICO');
    expect(inner.emit.cnpj).toBe('12345678000190');
    expect(inner.infModal.rodo.veicTracao.placa).toBe('ABC1D23');
    expect(inner.infModal.rodo.condutor[0].CPF).toBe('12345678900');
    expect(inner.infDoc.infMunDescarga[0].cMunDescarga).toBe('4106902');
    expect(inner.infDoc.infMunDescarga[0].infCTe[0].chCTe).toBe('35260812345678000190570010000000011000000010');
  });

  it('should return missing fields when required data is absent', () => {
    const invalidInput = { ...mockInput, vehicle: { plate: '', state: '' } };
    const result = buildMdfePayload(invalidInput as any);
    expect(result.ok).toBe(false);
    expect(result.missing).toContain('Placa do veículo');
  });
});
