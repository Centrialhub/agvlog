import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/routes/RouteDialog.tsx', 'utf8');

describe('monitored route dialog accessibility', () => {
  it('describes the route monitoring form for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Defina os pontos estratégicos e os limites usados para monitorar este corredor.');
  });
});
