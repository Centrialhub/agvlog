import { describe, expect, it } from 'vitest';
import { readAuthorizedCteHubDetails, readCtePayloadRecipient } from '@/lib/fiscal/ctePayload';

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
