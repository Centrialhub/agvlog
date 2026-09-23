import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('seleção paginada do acerto manual', () => {
  it('preserva metadados das páginas selecionadas e bloqueia mistura de motoristas', () => {
    const dialog = readFileSync('src/components/financial/NewManualSettlementDialog.tsx', 'utf8');
    const picker = readFileSync('src/components/financial/LoadPicker.tsx', 'utf8');
    expect(dialog).toContain('const byId = new Map(current.map(load => [load.id, load]))');
    expect(dialog).toContain('onLoadsChange={rememberAvailableLoads}');
    expect(picker).toContain('aria-label="Selecionar todos os romaneios disponíveis"');
    expect(picker).toContain('aria-label={`Selecionar romaneio ${l.load_number ?? l.id}`}');
    expect(dialog).toContain('selectedLoads.length !== selectedIds.length');
    expect(dialog).toContain('setSelectedIds(current => current.filter');
    expect(picker).toContain('selectableLoads.map((load) => load.id)');
    expect(picker).toContain('disabled={selectableLoads.length === 0}');
  });
});
