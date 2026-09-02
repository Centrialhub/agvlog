import { describe, expect, it } from 'vitest';
import { readAuthorizedCteHubDetails, readCteMdfeDetails, readCtePayloadRecipient } from '@/lib/fiscal/ctePayload';

describe('readCtePayloadRecipient', () => {
  it('reads recipient and destination data from a Hub Fiscal payload', () => {
    expect(readCtePayloadRecipient({
      payload: {
        destinatario: { nome: 'Cliente A', endereco: { municipio: 'Fallback', uf: 'SP' } },
        fim: { municipio: 'Campinas', uf: 'MG' },
      },
    })).toEqual({ name: 'Cliente A', city: 'Campinas', state: 'MG' });
  });

  it('falls back to the recipient address and rejects malformed JSON shapes', () => {
    expect(readCtePayloadRecipient({
      payload: { destinatario: { endereco: { municipio: 'Santos', uf: 'SP' } } },
    })).toEqual({ name: null, city: 'Santos', state: 'SP' });
    expect(readCtePayloadRecipient(['invalid'])).toEqual({ name: null, city: null, state: null });
  });
});

describe('readAuthorizedCteHubDetails', () => {
  it('reads nested document payloads without trusting malformed JSON', () => {
    expect(readAuthorizedCteHubDetails({
      document: {
        accessKey: '12345678901234567890123456789012345678901234',
        payload: {
          rem: {
            ie: '123',
            endereco: {
              logradouro: 'Rua A', numero: '10', bairro: 'Centro',
              municipio: 'Campinas', codigoMunicipio: '3509502', uf: 'SP', CEP: '13000000',
            },
          },
        },
      },
    })).toEqual({
      accessKey: '12345678901234567890123456789012345678901234',
      remitter: {
        stateRegistration: '123', street: 'Rua A', number: '10', neighborhood: 'Centro',
        city: 'Campinas', cityIbge: '3509502', state: 'SP', zip: '13000000',
      },
    });

    expect(readAuthorizedCteHubDetails(['invalid']).accessKey).toBeNull();
  });
});

describe('readCteMdfeDetails', () => {
  it('reads cargo value, third-party taker and insurance endorsements from the immutable CT-e snapshot', () => {
    expect(readCteMdfeDetails({
      payload: {
        valores: { valorCarga: 51165.88 },
        mercadoria: { produto: 'CAIXAS DE PAPELAO' },
        tomador: {
          role: 'terceiro',
          dados: {
            nome: 'CONTRATANTE REAL',
            cnpj: '11222333000181',
            ie: '001234567',
            endereco: {
              logradouro: 'Rua A', numero: '10', bairro: 'Centro',
              municipio: 'Montes Claros', cMun: '3143302', uf: 'MG', cep: '39400000',
            },
          },
        },
        seguro: { nAver: ['AV-1', 'AV-2'] },
      },
    }, 'terceiro')).toEqual({
      cargoValue: 51165.88,
      predominantProduct: 'CAIXAS DE PAPELAO',
      takerRole: 'terceiro',
      taker: {
        name: 'CONTRATANTE REAL', taxId: '11222333000181', stateRegistration: '001234567',
        street: 'Rua A', number: '10', neighborhood: 'Centro', city: 'Montes Claros',
        cityIbge: '3143302', state: 'MG', zip: '39400000',
      },
      insuranceEndorsements: ['AV-1', 'AV-2'],
    });
  });

  it('uses the stored role to select a recipient and rejects malformed snapshots', () => {
    expect(readCteMdfeDetails({
      payload: {
        destinatario: { nome: 'DESTINATARIO', cpf: '12345678900' },
        tomador: { role: 'remetente' },
      },
    }, 'destinatario')).toMatchObject({
      takerRole: 'destinatario',
      taker: { name: 'DESTINATARIO', taxId: '12345678900' },
    });
    expect(readCteMdfeDetails(['invalid'])).toEqual({
      cargoValue: null,
      predominantProduct: null,
      takerRole: null,
      taker: null,
      insuranceEndorsements: [],
    });
  });
});
