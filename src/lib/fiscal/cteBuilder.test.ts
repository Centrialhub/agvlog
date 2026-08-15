import { describe, it, expect } from 'vitest';
import { buildCtePayload } from './cteBuilder';

describe('cteBuilder manual overrides', () => {
  it('should apply manual address overrides to recipient', () => {
    const input: any = {
      emitter: {
        cnpj: '12345678000100',
        name: 'EMITTER SA',
        address: { street: 'Rua E', number: '10', city: 'City E', state: 'SP', zip: '01000000' }
      },
      remitter: {
        cnpj: '99999999000199',
        name: 'REM SA',
        address: { street: 'Rem St', number: '1', zip: '00000000' }
      },
      recipient: {
        cnpj: '42985218000435',
        name: 'COMERCIAL GALA LTDA',
        address: { street: 'Old Street', number: '0', neighborhood: 'Old', city: 'Old City', state: 'MG', zip: '39000000' }
      },
      invoices: [{ number: '1', access_key: '1'.repeat(44) }],
      insurer: {
        name: 'INS SA',
        cnpj: '00000000000191',
        policy: 'POL123',
        endorsement: 'END123'
      },
      overrides: {
        recipient: {
          street: 'AV DEPUTADO PLINIO RIBEIRO',
          number: '3535',
          neighborhood: 'JARDIM PALMEIRAS',
          zip: '39402194'
        }
      },
      totals: { freight_value: 100, cargo_value: 1000, weight_kg: 500 },
      takerRole: 'remetente',
      nature: 'PRESTACAO',
      cfop: '5353'
    };

    const result = buildCtePayload(input);
    expect(result.ok, `Missing: ${result.missing.join(', ')}`).toBe(true);
    const payload = result.payload.payload as any;
    const dest = payload.destinatario.endereco;
    expect(dest.logradouro).toBe('AV DEPUTADO PLINIO RIBEIRO');
    expect(dest.numero).toBe('3535');
    expect(dest.bairro).toBe('JARDIM PALMEIRAS');
    expect(dest.cep).toBe('39402194');
  });

  it('should apply manual address overrides to remitter', () => {
    const input: any = {
      emitter: { cnpj: '1' },
      remitter: {
        cnpj: '2',
        name: 'REM SA',
        address: { street: 'A', number: '1', zip: '0' }
      },
      overrides: {
        remitter: { street: 'NEW REM ST', zip: '12345678' }
      },
      totals: { freight_value: 100 },
      nature: 'X',
      cfop: '5353'
    };

    const result = buildCtePayload(input);
    const payload = result.payload.payload as any;
    expect(payload.remetente.endereco.logradouro).toBe('NEW REM ST');
    expect(payload.remetente.endereco.cep).toBe('12345678');
  });
});
