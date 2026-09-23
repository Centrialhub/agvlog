import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useStock.tsx','utf8');
const page=readFileSync('src/pages/Stock.tsx','utf8');

describe('edição e movimentação seguras de estoque',()=>{
  it('escopa a edição pelo tenant e revisão original e limpa diálogos na troca',()=>{
    expect(hook).toContain(".eq('id', id).eq('tenant_id', currentTenant.id).eq('updated_at', expected_updated_at)");
    expect(page).toContain('expected_updated_at: editingItem.updated_at');
    expect(page).toContain('},[currentTenant?.id])');
  });

  it('libera rejeições definitivas e oferece recuperação ou descarte de incertezas',()=>{
    expect(hook).toContain('isDefinitiveOperatorCommandRejection(error)');
    expect(hook).toContain('recoverPending:async()=>');
    expect(hook).toContain('discardPending:()=>');
    expect(page).toContain('Reenviar pendente');
    expect(page).toContain('Descartar pendente');
  });
});
