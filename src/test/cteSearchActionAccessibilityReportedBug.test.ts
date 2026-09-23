import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('CT-e search row action accessibility regression', () => {
  it('gives every icon-only row action a CT-e-specific accessible name', () => {
    const source = readFileSync('src/pages/CteSearch.tsx', 'utf8');

    for (const label of [
      'Visualizar DACTE do ${rowLabel}',
      'Baixar PDF do ${rowLabel}',
      'Baixar XML do ${rowLabel}',
      'Cancelar ${rowLabel}',
      'Consultar ou recuperar operação do ${rowLabel}',
    ]) {
      expect(source).toContain(`aria-label={\`${label}\`}`);
    }
    expect(source).toContain('`Remover rascunho do ${rowLabel}`');
    expect(source).toContain('`Excluir registro de erro do ${rowLabel}`');
  });
});
