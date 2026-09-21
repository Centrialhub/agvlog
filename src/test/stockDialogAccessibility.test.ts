import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Stock.tsx', 'utf8');

describe('stock dialog accessibility', () => {
  it('describes item and movement forms for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Cadastre a identificação, a categoria e os limites de estoque do novo item.');
    expect(source).toContain('Registre uma entrada, saída ou ajuste de saldo para um item do estoque.');
  });
});
