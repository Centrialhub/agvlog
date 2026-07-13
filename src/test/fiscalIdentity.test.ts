import { describe, it, expect } from 'vitest';
import {
  buildFiscalDocumentIdentity,
  normalizeFiscalNumber,
  normalizeTaxId,
  isUniqueViolation,
} from '@/lib/fiscalDocuments/fiscalIdentity';

const T = '11111111-1111-1111-1111-111111111111';
const T2 = '22222222-2222-2222-2222-222222222222';

describe('normalizeTaxId', () => {
  it('keeps only digits', () => {
    expect(normalizeTaxId('12.345.678/0001-90')).toBe('12345678000190');
    expect(normalizeTaxId('12345678000190')).toBe('12345678000190');
    expect(normalizeTaxId(null)).toBe('');
  });
});

describe('normalizeFiscalNumber', () => {
  it('strips leading zeros and punctuation', () => {
    expect(normalizeFiscalNumber('000123')).toBe('123');
    expect(normalizeFiscalNumber('123')).toBe('123');
    expect(normalizeFiscalNumber('0')).toBe('0');
    expect(normalizeFiscalNumber('')).toBe('');
    expect(normalizeFiscalNumber(' 12.3 ')).toBe('123');
  });
});

describe('buildFiscalDocumentIdentity', () => {
  it('prioritizes access key', () => {
    const a = buildFiscalDocumentIdentity({
      tenantId: T, accessKey: '35240111111111000111550010000001231000000019',
      emitterCnpj: '11111111000111', invoiceNumber: '123',
    });
    const b = buildFiscalDocumentIdentity({
      tenantId: T, accessKey: '35240111111111000111550010000001231000000019',
      emitterCnpj: '99999999999999', invoiceNumber: '999',
    });
    expect(a).toBe(b);
  });

  it('treats same number/series for different suppliers as distinct', () => {
    const a = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '11111111000111', invoiceNumber: '123', series: '1' });
    const b = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '22222222000122', invoiceNumber: '123', series: '1' });
    expect(a).not.toBe(b);
  });

  it('treats same supplier with different series as distinct', () => {
    const a = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '11111111000111', invoiceNumber: '123', series: '1' });
    const b = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '11111111000111', invoiceNumber: '123', series: '2' });
    expect(a).not.toBe(b);
  });

  it('collapses formatting differences into the same identity', () => {
    const a = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '12.345.678/0001-90', invoiceNumber: '000123', series: '01', model: '055' });
    const b = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '12345678000190', invoiceNumber: '123', series: '1', model: '55' });
    expect(a).toBe(b);
  });

  it('scopes identity by tenant', () => {
    const a = buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '11111111000111', invoiceNumber: '123' });
    const b = buildFiscalDocumentIdentity({ tenantId: T2, emitterCnpj: '11111111000111', invoiceNumber: '123' });
    expect(a).not.toBe(b);
  });

  it('returns null when neither key nor cnpj+number are available', () => {
    expect(buildFiscalDocumentIdentity({ tenantId: T, invoiceNumber: '123' })).toBeNull();
    expect(buildFiscalDocumentIdentity({ tenantId: T, emitterCnpj: '11111111000111' })).toBeNull();
  });
});

describe('isUniqueViolation', () => {
  it('detects PG 23505 by code', () => {
    expect(isUniqueViolation({ code: '23505', message: 'x' })).toBe(true);
  });
  it('detects by message when code missing', () => {
    expect(isUniqueViolation({ message: 'duplicate key value violates unique constraint "uq_x"' })).toBe(true);
  });
  it('ignores unrelated errors', () => {
    expect(isUniqueViolation({ code: '23503', message: 'fk' })).toBe(false);
    expect(isUniqueViolation(null)).toBe(false);
  });
});