import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Inventory.tsx', 'utf8');

describe('inventory dialog accessibility', () => {
  it('describes location and movement forms for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Cadastre a identificação e a descrição de um novo local físico do inventário.');
    expect(source).toContain('Registre uma entrada, saída, transferência ou ajuste no inventário logístico.');
  });
});
