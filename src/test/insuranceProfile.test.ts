import { describe, it, expect } from 'vitest';
import {
  applyInsuranceProfileToBatch,
  hasInsuranceProfile,
  mergeInsurerFields,
  normalizeInsuranceProfile,
  preserveInsurerFields,
} from '@/lib/fiscal/insuranceProfile';

type Item = {
  id: string;
  insurerName: string;
  insurerCnpj: string;
  insurerPolicy: string;
  insurerEndorsement: string;
};

const item = (over: Partial<Item> = {}): Item => ({
  id: 'c1',
  insurerName: '',
  insurerCnpj: '',
  insurerPolicy: '',
  insurerEndorsement: '',
  ...over,
});

const PROFILE = {
  name: '  AKAD SEGUROS ',
  cnpj: '18.666.510/0001-68',
  policy: ' 2798202301065400079 ',
};

describe('normalizeInsuranceProfile', () => {
  it('limpa espaços e máscara do CNPJ', () => {
    expect(normalizeInsuranceProfile(PROFILE)).toEqual({
      name: 'AKAD SEGUROS',
      cnpj: '18666510000168',
      policy: '2798202301065400079',
    });
  });

  it('perfil vazio/nulo não é considerado salvo', () => {
    expect(hasInsuranceProfile(null)).toBe(false);
    expect(hasInsuranceProfile({ name: '   ', cnpj: '', policy: '' })).toBe(false);
    expect(hasInsuranceProfile(PROFILE)).toBe(true);
  });
});

describe('mergeInsurerFields', () => {
  it('preenche campos vazios sem force', () => {
    const r = mergeInsurerFields(item(), PROFILE);
    expect(r.insurerName).toBe('AKAD SEGUROS');
    expect(r.insurerCnpj).toBe('18666510000168');
    expect(r.insurerPolicy).toBe('2798202301065400079');
  });

  it('sem force preserva edição manual do usuário', () => {
    const r = mergeInsurerFields(item({ insurerName: 'OUTRA SEG' }), PROFILE);
    expect(r.insurerName).toBe('OUTRA SEG');
    expect(r.insurerPolicy).toBe('2798202301065400079');
  });

  it('com force sobrescreve valores existentes', () => {
    const r = mergeInsurerFields(item({ insurerName: 'OUTRA SEG' }), PROFILE, true);
    expect(r.insurerName).toBe('AKAD SEGUROS');
  });

  it('nunca toca na averbação (CGC), que é por CT-e', () => {
    const r = mergeInsurerFields(item({ insurerEndorsement: 'AV-1' }), PROFILE, true);
    expect(r.insurerEndorsement).toBe('AV-1');
    expect((PROFILE as any).endorsement).toBeUndefined();
  });
});

describe('applyInsuranceProfileToBatch', () => {
  it('aplica o padrão a TODOS os CT-es do lote', () => {
    const { items, changed } = applyInsuranceProfileToBatch(
      [item({ id: 'a' }), item({ id: 'b' }), item({ id: 'c' })],
      PROFILE,
    );
    expect(changed).toBe(true);
    for (const it of items) {
      expect(it.insurerName).toBe('AKAD SEGUROS');
      expect(it.insurerCnpj).toBe('18666510000168');
      expect(it.insurerPolicy).toBe('2798202301065400079');
    }
  });

  it('mantém averbações distintas por CT-e', () => {
    const { items } = applyInsuranceProfileToBatch(
      [item({ id: 'a', insurerEndorsement: 'AV-1' }), item({ id: 'b', insurerEndorsement: 'AV-2' })],
      PROFILE,
      true,
    );
    expect(items.map((i) => i.insurerEndorsement)).toEqual(['AV-1', 'AV-2']);
  });

  it('não sinaliza mudança quando já está aplicado (evita loop de estado)', () => {
    const first = applyInsuranceProfileToBatch([item()], PROFILE);
    const second = applyInsuranceProfileToBatch(first.items, PROFILE);
    expect(second.changed).toBe(false);
    expect(second.items).toBe(first.items);
  });

  it('perfil não salvo deixa o lote intacto', () => {
    const arr = [item()];
    const r = applyInsuranceProfileToBatch(arr, {});
    expect(r.changed).toBe(false);
    expect(r.items).toBe(arr);
  });
});

describe('preserveInsurerFields', () => {
  it('pré-preenchimento assíncrono não apaga a seguradora aplicada', () => {
    const current = item({ insurerName: 'AKAD SEGUROS', insurerCnpj: '18666510000168', insurerPolicy: 'AP-9' });
    const incoming = item({ id: 'c1' });
    const r = preserveInsurerFields(current, incoming);
    expect(r.insurerName).toBe('AKAD SEGUROS');
    expect(r.insurerCnpj).toBe('18666510000168');
    expect(r.insurerPolicy).toBe('AP-9');
  });

  it('usa o valor do RPC quando o estado atual está vazio', () => {
    const r = preserveInsurerFields(item(), item({ insurerName: 'HUB SEG' }));
    expect(r.insurerName).toBe('HUB SEG');
  });
});
