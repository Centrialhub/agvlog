import { describe, it, expect } from 'vitest';
import { normalizeCity, normalizeCityKey } from '@/lib/utils/normalizeCity';

describe('normalizeCity', () => {
  it('igualdades com/sem acento', () => {
    expect(normalizeCity('Janaúba')).toBe(normalizeCity('Janauba'));
    expect(normalizeCity('São Paulo')).toBe(normalizeCity('Sao Paulo'));
    expect(normalizeCity('Coração de Jesus')).toBe('CORACAO DE JESUS');
  });
  it('colapsa espaços múltiplos', () => {
    expect(normalizeCity('  São   João  ')).toBe('SAO JOAO');
  });
  it('retorna string vazia para entrada vazia', () => {
    expect(normalizeCity('')).toBe('');
    expect(normalizeCity(null)).toBe('');
    expect(normalizeCity(undefined)).toBe('');
  });
  it('normalizeCityKey usa sentinel para vazio', () => {
    expect(normalizeCityKey('')).toBe('SEM CIDADE');
    expect(normalizeCityKey('Janaúba')).toBe('JANAUBA');
  });
});