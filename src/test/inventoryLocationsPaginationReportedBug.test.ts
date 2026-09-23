import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook=readFileSync('src/hooks/useInventory.tsx','utf8');
const page=readFileSync('src/pages/Inventory.tsx','utf8');

describe('catálogo completo de locais de estoque',()=>{
  it('percorre páginas com uma ordem total estável',()=>{
    const locations=hook.slice(hook.indexOf('export function useInventoryLocations'),hook.indexOf('export function useCreateLocation'));
    expect(locations).toContain('fetchAllPostgrestPages<InventoryLocation>');
    expect(locations).toContain(".order('name')");
    expect(locations).toContain(".order('id')");
    expect(locations).toContain('.range(from,to)');
  });

  it('reutiliza o catálogo completo no KPI, filtro e formulário',()=>{
    expect(page).toContain('locations={locations}');
    expect(page).toContain('{locations.length}');
    expect(page).toContain('...locations.map(location =>');
  });
});
