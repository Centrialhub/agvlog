import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const hook = readFileSync('src/hooks/useInventory.tsx','utf8');
const page = readFileSync('src/pages/Inventory.tsx','utf8');
const dashboard = readFileSync('src/pages/OperationsDashboard.tsx','utf8');
const migration = readFileSync('supabase/migrations/20260917144600_add_inventory_summary.sql','utf8');

describe('bounded inventory screen reads',()=>{
  it('pages balances, movements and aging instead of exhausting PostgREST',()=>{
    expect(hook).not.toContain('fetchAllPostgrestPages');
    expect(hook).toContain('INVENTORY_PAGE_SIZE = 50');
    expect(hook.match(/\.range\(/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page.match(/<DataPagination/g)?.length).toBe(3);
    expect(page).toContain('Filtros aplicados no servidor ao histórico paginado.');
  });

  it('gets global KPIs and the client chart from a bounded aggregate',()=>{
    expect(migration).toContain("'stock_by_client'");
    expect(migration).toContain('limit 10');
    expect(hook).toContain("rpc('get_inventory_summary_v1'");
    expect(dashboard).toContain('inventorySummary?.stockByClient');
    expect(dashboard).not.toContain('useInventoryBalances');
  });
});
