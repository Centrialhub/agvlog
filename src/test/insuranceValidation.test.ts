import { describe, it, expect } from 'vitest';
import { isValidCnpj, formatCnpj, validateInsurance } from '@/lib/fiscal/insuranceValidation';

describe('insuranceValidation', () => {
  it('valida CNPJ com dígitos verificadores', () => {
    expect(isValidCnpj('18.666.510/0001-68')).toBe(true);
    expect(isValidCnpj('18666510000169')).toBe(false);
    expect(isValidCnpj('11111111111111')).toBe(false);
    expect(isValidCnpj('123')).toBe(false);
  });

  it('formata CNPJ progressivamente', () => {
    expect(formatCnpj('18666510000168')).toBe('18.666.510/0001-68');
    expect(formatCnpj('1866')).toBe('18.66');
  });

  it('exige seguradora, CNPJ, apólice e averbação', () => {
    const r = validateInsurance(null);
    expect(r.ok).toBe(false);
    expect(Object.keys(r.errors).sort()).toEqual(['cnpj', 'endorsement', 'name', 'policy']);
  });

  it('rejeita formatos inválidos de apólice/averbação', () => {
    const r = validateInsurance({
      name: 'AK',
      cnpj: '18666510000168',
      policy: 'A',
      endorsement: 'AV#1',
    });
    expect(r.ok).toBe(false);
    expect(r.errors.name).toMatch(/3 caracteres/);
    expect(r.errors.policy).toMatch(/inválido/);
    expect(r.errors.endorsement).toMatch(/inválido/);
  });

  it('aceita dados completos e válidos', () => {
    const r = validateInsurance({
      name: 'AKAD SEGUROS',
      cnpj: '18.666.510/0001-68',
      policy: '2798202301065400079',
      endorsement: 'AV-2026/001',
    });
    expect(r.ok).toBe(true);
    expect(r.messages).toHaveLength(0);
  });
});
