import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OperationalRoutesPage.tsx', 'utf8');

describe('operational route dialog accessibility', () => {
  it('describes the route form for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Defina a identificação, a classificação e os destinos atendidos pela rota operacional.');
  });
});
