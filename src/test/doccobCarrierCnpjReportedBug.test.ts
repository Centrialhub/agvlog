import { describe, expect, it } from 'vitest';
import { validateDoccobExportInput } from '@/lib/doccob/doccobValidator';
import type { DoccobBuildInput } from '@/lib/doccob/doccobTypes';

function input(cnpj: string): DoccobBuildInput {
  return {
    carrier: { cnpj, name: 'Transportadora' },
    profile: {},
    invoices: [],
  };
}

describe('CNPJ da transportadora no DOCCOB', () => {
  it.each(['1', '00000000000000', '12345678000190'])('rejeita documento inválido %s', (cnpj) => {
    expect(validateDoccobExportInput(input(cnpj))).toEqual(expect.arrayContaining([
      expect.objectContaining({ code: 'carrier_cnpj_invalid', level: 'error' }),
    ]));
  });

  it('aceita CNPJ com 14 dígitos e verificadores válidos', () => {
    expect(validateDoccobExportInput(input('11.222.333/0001-81')).some(issue => issue.code.startsWith('carrier_cnpj'))).toBe(false);
  });
});
