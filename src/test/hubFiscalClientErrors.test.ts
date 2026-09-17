import { describe, expect, it } from 'vitest';
import { readHubFiscalError } from '@/lib/fiscal/hubFiscalClient';

describe('readHubFiscalError', () => {
  it('keeps validation details for address fields', () => {
    const message = readHubFiscalError({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Payload inválido',
        details: {
          'tomador.endereco.cep': 'CEP inválido',
          'tomador.endereco.codigoCidade': 'Código IBGE obrigatório',
        },
      },
    });

    expect(message).toContain('VALIDATION_ERROR: Payload inválido');
    expect(message).toContain('tomador.endereco.cep: CEP inválido');
    expect(message).toContain('tomador.endereco.codigoCidade: Código IBGE obrigatório');
  });

  it('combines provider status, messages and hints', () => {
    const message = readHubFiscalError({
      code: 'CTE_REJECTED',
      cStat: 999,
      messages: ['Município do destinatário inválido'],
      hints: ['Revise o código IBGE'],
    });

    expect(message).toBe('CTE_REJECTED: cStat 999 | Município do destinatário inválido | Revise o código IBGE');
  });
});
