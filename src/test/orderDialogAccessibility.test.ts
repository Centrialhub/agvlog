import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Orders.tsx', 'utf8');

describe('order dialog accessibility', () => {
  it('describes create and edit forms for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Cadastre os dados operacionais, comerciais e fiscais do novo pedido.');
    expect(source).toContain('Revise os dados operacionais, comerciais e fiscais do pedido.');
  });
});
