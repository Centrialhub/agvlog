import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/components/routes/RouteDialog.tsx', 'utf8');

describe('monitored route form validation', () => {
  it('blocks invalid identity and monitoring values before submission', () => {
    expect(source).toContain("toast.error('Informe o nome da rota')");
    expect(source).toContain("toast.error('Revise os limites de monitoramento e a duração dos pontos da rota')");
    expect(source).toContain('const thresholdPercent = Number(threshold)');
    expect(source).toContain('thresholdPercent < 50 || thresholdPercent > 100');
    expect(source).toContain('|| !name.trim()');
    expect(source).toContain('Number(outsideMin) < 0');
  });
});
