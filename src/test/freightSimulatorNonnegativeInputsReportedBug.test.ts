import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightSimulator.tsx', 'utf8');

describe('métricas não negativas na interface do simulador', () => {
  it('impõe mínimo zero nos três campos econômicos', () => {
    expect(page).toMatch(/min="0"[^>]*value=\{totalValue\}/);
    expect(page).toMatch(/min="0"[^>]*value=\{totalWeight\}/);
    expect(page).toMatch(/min="0"[^>]*value=\{totalPallets\}/);
  });
});
