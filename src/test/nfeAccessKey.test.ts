import { describe, expect, it } from 'vitest';

import {
  calculateNfeAccessKeyCheckDigit,
  isValidNfeAccessKey,
  normalizeNfeAccessKey,
} from '@/lib/fiscalDocuments/nfeAccessKey';

describe('NF-e access key', () => {
  it('normaliza máscara e valida o dígito verificador', () => {
    const firstFortyThree = '3526081234567800019055001000000123112345678';
    const checkDigit = calculateNfeAccessKeyCheckDigit(firstFortyThree);
    const key = `${firstFortyThree}${checkDigit}`;

    expect(key).toHaveLength(44);
    expect(normalizeNfeAccessKey(key.replace(/(.{4})/g, '$1 '))).toBe(key);
    expect(isValidNfeAccessKey(key)).toBe(true);
    expect(isValidNfeAccessKey(`${key.slice(0, 43)}${checkDigit === 9 ? 8 : Number(checkDigit) + 1}`)).toBe(false);
  });

  it('rejeita chave ausente ou com tamanho inválido', () => {
    expect(isValidNfeAccessKey('')).toBe(false);
    expect(isValidNfeAccessKey('123')).toBe(false);
  });
});
