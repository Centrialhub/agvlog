import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightSimulator.tsx', 'utf8');

describe('ambiguidade da busca rápida local', () => {
  it('mede todas as correspondências antes de carregar um documento', () => {
    const localSearch = page.slice(page.indexOf('// Try local first'), page.indexOf('// Fallback: query DB ignoring period filter'));
    expect(localSearch).toContain('filteredDocs.filter');
    expect(localSearch).not.toContain('filteredDocs.find');
    expect(localSearch).toContain('if (localMatches.length > 1)');
    expect(localSearch.indexOf('if (localMatches.length > 1)')).toBeLessThan(localSearch.indexOf('loadFromDoc(local.id)'));
  });

  it('orienta o usuário a informar identidade não ambígua', () => {
    expect(page).toContain('Informe a chave de acesso completa ou selecione o emitente correto.');
  });
});
