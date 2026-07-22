import { describe, it, expect } from 'vitest';
import { mergeDestinations } from '@/pages/LoadReallocation';
import { normalizeCity } from '@/lib/utils/normalizeCity';

describe('mergeDestinations – dedupe acento/case invariante', () => {
  it('não duplica tokens que só diferem em acento', () => {
    const combined = mergeDestinations('PAI PEDRO - SÃO PAULO', 'PAI PEDRO - SAO PAULO');
    // Deve haver apenas 2 tokens depois de dedup normalizado.
    const tokens = (combined || '').split(' - ');
    expect(tokens).toHaveLength(2);
  });

  it('não duplica tokens que só diferem em caixa', () => {
    const combined = mergeDestinations('pirapora - jaiba', 'PIRAPORA - JAIBA');
    expect((combined || '').split(' - ')).toHaveLength(2);
  });

  it('preserva o primeiro token na saída', () => {
    const combined = mergeDestinations('São Paulo', 'SAO PAULO - Guarulhos');
    // 1º token vem do target original ("São Paulo"), Guarulhos entra depois.
    const tokens = (combined || '').split(' - ');
    expect(tokens[0]).toBe('São Paulo');
    expect(tokens.map(t => normalizeCity(t))).toEqual(['SAO PAULO', 'GUARULHOS']);
  });

  it('retorna target quando não há tokens úteis', () => {
    expect(mergeDestinations(null, null)).toBeNull();
    expect(mergeDestinations('X', null)).toBe('X');
  });
});