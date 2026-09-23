import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page = readFileSync('src/pages/FreightTables.tsx', 'utf8');

describe('data inicial de nova tabela de frete', () => {
  it('calcula a data civil em uma fábrica, não na carga do módulo', () => {
    expect(page).toContain('const createEmptyForm = () => ({');
    expect(page).toContain('valid_from: localDateInputValue()');
    expect(page).not.toContain('const emptyForm =');
    expect(page).toContain('useState(createEmptyForm)');
  });

  it('cria um formulário novo no momento em que o diálogo de cadastro abre', () => {
    expect(page).toContain('else if (!editingId) setForm(createEmptyForm())');
    expect(page).toContain('setForm(createEmptyForm())');
  });
});
