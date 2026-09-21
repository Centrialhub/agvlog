import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Incidents.tsx', 'utf8');

describe('formal incident dialog accessibility', () => {
  it('describes the incident form for assistive technology', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Registre os dados, vínculos, custos e plano de ação da ocorrência formal.');
  });
});
