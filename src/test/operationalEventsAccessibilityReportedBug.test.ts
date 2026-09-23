import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('acessibilidade da tabela de ocorrências', () => {
  const page = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');

  it('torna a linha focável e acionável por Enter ou Espaço', () => {
    expect(page).toContain('role="button"');
    expect(page).toContain('tabIndex={0}');
    expect(page).toContain("event.key !== 'Enter' && event.key !== ' '");
    expect(page).toContain('Abrir detalhes da ocorrência');
  });

  it('nomeia ações da ocorrência e todos os controles de paginação', () => {
    expect(page).toContain('aria-label={`Abrir conversa da ocorrência');
    expect(page).toContain('aria-label={`Resolver ocorrência');
    for (const label of ['primeira página', 'página anterior', 'próxima página', 'última página']) {
      expect(page).toContain(`aria-label="Ir para a ${label}"`);
    }
  });
});
