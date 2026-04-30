import { describe, it, expect } from 'vitest';
import {
  inferFromCfop,
  inferFromText,
  inferOperationType,
  toDbOperationType,
  fromDbOperationType,
  OPERATION_TYPE_NONE,
} from '@/lib/operationTypeMapping';

describe('inferFromCfop', () => {
  it('detecta transferência (mesmo CNPJ)', () => {
    expect(inferFromCfop('5151')).toBe('transferencia');
    expect(inferFromCfop('6152')).toBe('transferencia');
    expect(inferFromCfop('5409')).toBe('transferencia');
  });

  it('detecta devolução', () => {
    expect(inferFromCfop('5202')).toBe('devolucao');
    expect(inferFromCfop('6411')).toBe('devolucao');
  });

  it('detecta redespacho', () => {
    expect(inferFromCfop('5353')).toBe('redespacho');
    expect(inferFromCfop('6360')).toBe('redespacho');
  });

  it('detecta armazenagem', () => {
    expect(inferFromCfop('5905')).toBe('armazenagem');
    expect(inferFromCfop('5352')).toBe('armazenagem');
  });

  it('detecta frota (5359)', () => {
    expect(inferFromCfop('5359')).toBe('frota');
  });

  it('cai em viagem_direta como fallback de saída', () => {
    expect(inferFromCfop('5102')).toBe('viagem_direta');
    expect(inferFromCfop('6108')).toBe('viagem_direta');
  });

  it('retorna null para entrada / inválido', () => {
    expect(inferFromCfop('1102')).toBeNull();
    expect(inferFromCfop('abc')).toBeNull();
    expect(inferFromCfop(null)).toBeNull();
  });
});

describe('inferFromText', () => {
  it('detecta devolução por palavra-chave', () => {
    expect(inferFromText('Devolução de mercadoria avariada')).toBe('devolucao');
  });
  it('detecta retira', () => {
    expect(inferFromText('Cliente retira na origem')).toBe('retira');
  });
  it('detecta armazenagem', () => {
    expect(inferFromText('Cross-dock filial SP')).toBe('armazenagem');
  });
  it('retorna null sem keyword', () => {
    expect(inferFromText('Pagamento à vista')).toBeNull();
  });
});

describe('inferOperationType — orquestração', () => {
  it('override vence tudo', () => {
    const r = inferOperationType({ override: 'frota', cfops: ['5202'] });
    expect(r.type).toBe('frota');
    expect(r.source).toBe('override');
  });

  it('mesmo CNPJ raiz → transferência', () => {
    const r = inferOperationType({
      emitterCnpj: '12.345.678/0001-99',
      recipientCnpj: '12345678000288',
      cfops: ['5102'],
    });
    expect(r.type).toBe('transferencia');
    expect(r.source).toBe('same-cnpj');
  });

  it('escolhe CFOP predominante quando múltiplos', () => {
    const r = inferOperationType({ cfops: ['5102', '5102', '5202'] });
    expect(r.type).toBe('viagem_direta');
  });

  it('fallback para natureza', () => {
    const r = inferOperationType({ cfops: [], natureza: 'Devolução de venda' });
    expect(r.type).toBe('devolucao');
    expect(r.source).toBe('natureza');
  });

  it('retorna null quando não há sinais', () => {
    const r = inferOperationType({});
    expect(r.type).toBeNull();
    expect(r.source).toBe('none');
  });
});

describe('conversores DB ↔ UI', () => {
  it('toDbOperationType normaliza sentinel', () => {
    expect(toDbOperationType(OPERATION_TYPE_NONE)).toBeNull();
    expect(toDbOperationType('')).toBeNull();
    expect(toDbOperationType('frota')).toBe('frota');
    expect(toDbOperationType('inválido')).toBeNull();
  });

  it('fromDbOperationType retorna sentinel para null', () => {
    expect(fromDbOperationType(null)).toBe(OPERATION_TYPE_NONE);
    expect(fromDbOperationType('frota')).toBe('frota');
  });
});