import { describe, expect, it } from 'vitest';
import { authErrorMessage } from '@/lib/auth/authErrorMessage';
import {
  fmtDateSafe,
  localDateInputValue,
  localDateTimeInputToIso,
  localDateTimeInputValue,
  optionalLocalDateUtcRange,
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

  it('converts a Sao Paulo datetime-local value without using the browser timezone', () => {
    expect(localDateTimeInputToIso('2026-09-16T21:30')).toBe('2026-09-17T00:30:00.000Z');
    expect(localDateTimeInputValue(localDateTimeInputToIso('2026-09-16T21:30'))).toBe('2026-09-16T21:30');
    expect(() => localDateTimeInputToIso('2026-02-30T10:00')).toThrow('Data e hora local inválida');
  });

  it('keeps an empty date selector from throwing during render', () => {
    expect(optionalLocalDateUtcRange('')).toBeNull();
    expect(optionalLocalDateUtcRange('2026-02-30')).toBeNull();
    expect(optionalLocalDateUtcRange('2026-09-21')).toEqual({
      from: '2026-09-21T03:00:00.000Z',
      toExclusive: '2026-09-22T03:00:00.000Z',
    });
  });

  it('translates invalid credentials without exposing the provider message', () => {
    expect(authErrorMessage({ message: 'Invalid login credentials' })).toBe('Email ou senha inválidos.');
    expect(authErrorMessage({ code: 'invalid_credentials' })).toBe('Email ou senha inválidos.');
  });
});
