import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock workspace bounded loading',()=>{
  it('pages filters on the server and defers catalogs and movement history',()=>{
    const migration=readFileSync('supabase/migrations/20260922001000_page_stock_workspace.sql','utf8');
    const hook=readFileSync('src/hooks/useStock.tsx','utf8');
    const page=readFileSync('src/pages/Stock.tsx','utf8');
    expect(migration).toContain('stock_items_page_v1');
    expect(migration).toContain('stock_movements_page_v1');
    expect(migration).toContain('limit _limit offset _offset');
    expect(migration).toContain('stock_workspace_metrics_v1');
    expect(hook).toContain("queryKey:['stock_items_page'");
    expect(hook).toContain("queryKey:['stock_movements_page'");
    expect(page).toContain("tab==='movements'");
    expect(page).toContain('useStockItems({enabled:movDialog})');
    expect(page).toContain('useEmployees({enabled:movDialog})');
    expect(page).not.toContain('usePagination(');
  });
});
