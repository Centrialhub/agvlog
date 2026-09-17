import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '@/lib/auth/authErrorMessage';
import {
  fmtDateSafe,
  localDateInputValue,
  localDateTimeInputValue,
} from '@/lib/utils/formatDate';

describe('reported bug regressions', () => {
  it('keeps date-only values on their calendar day', () => {
    expect(fmtDateSafe('2026-09-16')).toBe('16/09/2026');
  });

  it('uses the Sao Paulo business day instead of the UTC day', () => {
    const afterNinePmInSaoPaulo = new Date('2026-09-17T00:30:00.000Z');
    expect(localDateInputValue(afterNinePmInSaoPaulo)).toBe('2026-09-16');
    expect(localDateTimeInputValue(afterNinePmInSaoPaulo)).toBe('2026-09-16T21:30');
  });

  it('translates invalid credentials without exposing the provider message', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toBe('Email ou senha inválidos.');
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Email ou senha inválidos.');
  });
});
