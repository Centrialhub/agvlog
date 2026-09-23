import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260921180910_search_inventory_relations.sql','utf8');
const hook=readFileSync('src/hooks/useInventory.tsx','utf8');

describe('inventory relational search',()=>{
  it('matches item, client and location in both paged readers',()=>{
    expect(migration.match(/item_description ilike v_pattern/g)).toHaveLength(4);
    expect(migration.match(/company_name ilike v_pattern/g)).toHaveLength(4);
    expect(migration.match(/l\.name ilike v_pattern/g)).toHaveLength(4);
  });
  it('routes balances and movements through the relational readers',()=>{
    expect(hook).toContain("rpc('list_inventory_balances_page_v1'");
    expect(hook).toContain("rpc('list_inventory_movements_page_v1'");
    expect(hook).not.toContain("query.ilike('item_description'");
  });
});
