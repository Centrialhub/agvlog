import { describe, it, expect } from 'vitest';
import {
  matchOperationalRoute,
  type OperationalRouteRef,
} from '@/lib/routes/matchOperationalRoute';

/**
 * Exercita a mesma implementação usada em PendingDocsGrouping.tsx:
 * 1) match exato sobre substring
 * 2) escolha determinística quando >1 candidato (menor nome)
 * 3) sinaliza ambiguidade quando >1 candidato exato
 */
const routes: OperationalRouteRef[] = [
  { id: 'r1', name: 'ROTA - ITABIRA', destinations: [{ name: 'Itabira' }] },
  { id: 'r2', name: 'ROTA - ITABIRINHA', destinations: [{ name: 'Itabirinha' }] },
  { id: 'r3', name: 'MG-C. JESUS', destinations: [{ name: 'Coração de Jesus' }] },
  { id: 'r4', name: 'ROTA - CORACAO DE JESUS', destinations: [{ name: 'Coração de Jesus' }] },
  { id: 'r5', name: 'ROTA - RIO', destinations: [{ name: 'Rio Pardo' }] },
  { id: 'r6', name: 'ROTA - VELHO', destinations: [{ name: 'Velho' }] },
];

describe('route matcher', () => {
  it('não confunde ITABIRA com ITABIRINHA (match exato)', () => {
    const { matched, exact } = matchOperationalRoute('Itabira', routes);
    expect(matched?.id).toBe('r1');
    expect(exact).toBe(true);
  });

  it('ignora acentos', () => {
    const a = matchOperationalRoute('Coração de Jesus', routes);
    const b = matchOperationalRoute('CORACAO DE JESUS', routes);
    expect(a.matched?.id).toBe(b.matched?.id);
    expect(a.exact).toBe(true);
  });

  it('sinaliza ambiguidade quando 2 rotas cobrem a mesma cidade', () => {
    const r = matchOperationalRoute('Coração de Jesus', routes);
    expect(r.ambiguous).toBe(true);
    // determinístico: escolhe o menor nome
    expect(r.matched?.name).toBe('MG-C. JESUS');
  });

  it('não faz match fuzzy quando existe match exato (RIO não vaza para Rio Pardo)', () => {
    const { matched, exact } = matchOperationalRoute('Rio Pardo', routes);
    expect(matched?.id).toBe('r5');
    expect(exact).toBe(true);
  });

  it('retorna null para cidade sem rota', () => {
    const { matched } = matchOperationalRoute('Cidade Inexistente XYZ', routes);
    expect(matched).toBeNull();
  });

  it('fallback fuzzy usa limite de palavra (VELHO não casa com "Porto Velho" sem match exato)', () => {
    // Cidade "Porto Velho" — não há rota exata; fallback deve casar r6 (destino "Velho" existe como palavra inteira).
    const r = matchOperationalRoute('Porto Velho', routes);
    expect(r.exact).toBe(false);
    expect(r.matched?.id).toBe('r6');
  });

  it('fallback fuzzy NÃO casa quando token é apenas substring parcial de palavra', () => {
    // "Portovelh" (sem espaço) não deve casar "Velho" pois não é palavra inteira.
    const r = matchOperationalRoute('Portovelho', routes);
    expect(r.matched).toBeNull();
  });

  it('não associa cidade vazia a destinos vazios', () => {
    const r = matchOperationalRoute('', [
      { id: 'empty', name: 'ROTA SEM DESTINO', destinations: [{ name: '' }] },
    ]);
    expect(r).toEqual({ matched: null, ambiguous: false, exact: false });
  });
});
