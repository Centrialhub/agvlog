import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const source = readFileSync('src/pages/Checklists.tsx', 'utf8');

describe('checklist dialog accessibility', () => {
  it('describes template creation and checklist execution dialogs', () => {
    expect(source).toContain('DialogDescription');
    expect(source).toContain('Crie um modelo com os itens padrão do tipo de checklist selecionado.');
    expect(source).toContain('Confirme todos os itens e informe os vínculos operacionais antes de concluir o checklist.');
  });
});
