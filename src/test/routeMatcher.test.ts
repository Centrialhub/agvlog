import { describe, it, expect } from 'vitest';
import { normalizeCity } from '@/lib/utils/normalizeCity';

/**
 * Replica a lógica de matcher usada em PendingDocsGrouping.tsx para prevenir regressão:
 * 1) match exato sobre substring
 * 2) escolha determinística quando >1 candidato (menor nome)
 * 3) sinaliza ambiguidade quando >1 candidato exato
 */
interface RouteRef { id: string; name: string; destinations: { name: string }[] }

function matchRoute(city: string, routes: RouteRef[]) {
  const normalized = normalizeCity(city);
  const exact = routes.filter(r => r.destinations.some(d => normalizeCity(d.name) === normalized));
  const fuzzy = exact.length > 0 ? [] : routes.filter(r => r.destinations.some(d => {
    const nd = normalizeCity(d.name);
    return nd && (normalized.includes(nd) || nd.includes(normalized));
  }));
  const candidates = exact.length > 0 ? exact : fuzzy;
  const matched = candidates.length > 0 ? [...candidates].sort((a, b) => a.name.localeCompare(b.name))[0] : null;
  return { matched, ambiguous: candidates.length > 1, exact: exact.length > 0 };
}

const routes: RouteRef[] = [
  { id: 'r1', name: 'ROTA - ITABIRA', destinations: [{ name: 'Itabira' }] },
  { id: 'r2', name: 'ROTA - ITABIRINHA', destinations: [{ name: 'Itabirinha' }] },
  { id: 'r3', name: 'MG-C. JESUS', destinations: [{ name: 'Coração de Jesus' }] },
  { id: 'r4', name: 'ROTA - CORACAO DE JESUS', destinations: [{ name: 'Coração de Jesus' }] },
  { id: 'r5', name: 'ROTA - RIO', destinations: [{ name: 'Rio Pardo' }] },
];

describe('route matcher', () => {
  it('não confunde ITABIRA com ITABIRINHA (match exato)', () => {
    const { matched, exact } = matchRoute('Itabira', routes);
    expect(matched?.id).toBe('r1');
    expect(exact).toBe(true);
  });

  it('ignora acentos', () => {
    const a = matchRoute('Coração de Jesus', routes);
    const b = matchRoute('CORACAO DE JESUS', routes);
    expect(a.matched?.id).toBe(b.matched?.id);
    expect(a.exact).toBe(true);
  });

  it('sinaliza ambiguidade quando 2 rotas cobrem a mesma cidade', () => {
    const r = matchRoute('Coração de Jesus', routes);
    expect(r.ambiguous).toBe(true);
    // determinístico: escolhe o menor nome
    expect(r.matched?.name).toBe('MG-C. JESUS');
  });

  it('não faz match fuzzy quando existe match exato (RIO não vaza para Rio Pardo)', () => {
    const { matched, exact } = matchRoute('Rio Pardo', routes);
    expect(matched?.id).toBe('r5');
    expect(exact).toBe(true);
  });

  it('retorna null para cidade sem rota', () => {
    const { matched } = matchRoute('Cidade Inexistente XYZ', routes);
    expect(matched).toBeNull();
  });
});