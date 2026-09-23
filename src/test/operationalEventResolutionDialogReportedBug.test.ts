import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');

describe('resolução descritiva de ocorrência operacional', () => {
  it('abre um diálogo nos dois pontos de entrada em vez de enviar texto fixo', () => {
    expect(page).not.toContain("resolution: 'Resolvido pela operação'");
    expect(page.match(/openResolveDialog/g)?.length).toBeGreaterThanOrEqual(3);
    expect(page).toContain('<DialogTitle>Resolver ocorrência</DialogTitle>');
  });

  it('exige e envia a descrição normalizada ao comando auditável', () => {
    expect(page).toContain('const resolution = resolutionText.trim()');
    expect(page).toContain('resolution.length < 5 || resolution.length > 4000');
    expect(page).toContain('updateEvent.mutateAsync({ id: resolveTarget.id, resolution })');
    expect(page).toContain('maxLength={4000}');
  });

  it('descarta o rascunho quando o tenant muda', () => {
    expect(page).toMatch(/\[currentTenant\?\.id\][\s\S]*?const filtered/);
    expect(page).toContain("setResolveTarget(null); setResolutionText('');");
  });
});
