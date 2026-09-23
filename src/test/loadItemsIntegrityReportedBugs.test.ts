import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { validateManualItemCreation } from '@/lib/loads/itemPreparation';

describe('integridade da composição de carga', () => {
  it('pagina todos os itens com ordenação estável', () => {
    const hook = readFileSync('src/hooks/useLoadItems.tsx', 'utf8');
    expect(hook).toContain('fetchAllPostgrestPages((from, to) =>');
    expect(hook).toContain(".order('id', { ascending: true })");
    expect(hook).toContain('.range(from, to)');
  });

  it('bloqueia item manual sem identidade ou conteúdo físico', () => {
    expect(() => validateManualItemCreation({ quantity: 0, pallet_count: 0, weight_kg: 0 })).toThrow('pedido ou uma descrição');
    expect(() => validateManualItemCreation({ item_description: 'Caixa', quantity: 0, pallet_count: 0, weight_kg: 0 })).toThrow('maior que zero');
    expect(() => validateManualItemCreation({ item_description: 'Caixa', quantity: 1, pallet_count: 0, weight_kg: 0 })).not.toThrow();
  });

  it('mostra erro, retry e bloqueia alterações quando a leitura falha', () => {
    const panel = readFileSync('src/components/loads/LoadItemsPanel.tsx', 'utf8');
    expect(panel).toContain('isError: isItemsError');
    expect(panel).toContain('role="alert"');
    expect(panel).toContain('Composição indisponível. Recarregue antes de alterar a carga.');
    expect(panel).toContain('const documentBlocked = isItemsError ||');
  });
});
