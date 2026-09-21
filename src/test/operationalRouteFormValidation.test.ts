import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OperationalRoutesPage.tsx', 'utf8');

describe('operational route form validation', () => {
  it('blocks active routes without destinations and normalizes the name', () => {
    expect(source).toContain("toast.error('Adicione ao menos um destino para manter a rota ativa')");
    expect(source).toContain('name: form.name.trim()');
    expect(source).toContain('form.active && form.destinations.length === 0');
    expect(source).toContain('createRoute.isPending');
    expect(source).toContain('updateRoute.isPending');
  });
});
