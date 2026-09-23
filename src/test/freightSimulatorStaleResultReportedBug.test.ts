import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightSimulator.tsx', 'utf8');

describe('invalidação da prévia de frete', () => {
  it('invalida resultado e requisição em voo quando qualquer parâmetro muda', () => {
    const invalidation = page.slice(page.indexOf('// A prévia só é válida'), page.indexOf('// Auto-recalculate'));
    expect(invalidation).toContain('calculationGeneration.current += 1');
    expect(invalidation).toContain('setResult(null)');
    for (const dependency of ['tenantId', 'clientId', 'regionId', 'payerGroup', 'totalValue', 'totalWeight', 'totalPallets', 'destState', 'destMunicipality', 'docId']) {
      expect(invalidation).toContain(dependency);
    }
  });

  it('remove a prévia anterior no início e na falha da nova tentativa', () => {
    const simulation = page.slice(page.indexOf('const handleSimulate'), page.indexOf('// A prévia só é válida'));
    expect(simulation.match(/setResult\(null\)/g)).toHaveLength(2);
    expect(simulation).toContain('if (generation === calculationGeneration.current) setResult(null)');
  });
});
