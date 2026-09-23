import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/Inventory.tsx','utf8');
const migration=readFileSync('supabase/migrations/20260921195050_normalize_inventory_item_descriptions.sql','utf8');

describe('descrição canônica dos itens de inventário',()=>{
  it('remove espaços no formulário antes de criar o movimento',()=>{
    expect(page).toContain('item_description:form.item_description.trim()');
  });

  it('mescla saldos existentes e usa a descrição normalizada na chave lógica',()=>{
    expect(migration).toContain('btrim(item_description) item_description');
    expect(migration).toContain('and item_description=normalized_description for update');
    expect(migration).toContain('new.client_id,normalized_description,new.quantity*sign');
    expect(migration).toContain('inventory_movement_item_description_normalized');
  });
});
