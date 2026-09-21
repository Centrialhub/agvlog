import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/OperationalEvents.tsx', 'utf8');

describe('operational-event dialog accessibility', () => {
  it('describes occurrence registration and filter preset dialogs', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Registre o tipo, a severidade, os vínculos operacionais e o impacto da ocorrência.');
    expect(source).toContain('Salve os filtros atuais para reutilizar esta consulta de ocorrências.');
  });
});
