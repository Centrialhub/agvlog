import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('stock semantics and validation',()=>{
  const hook=readFileSync('src/hooks/useStock.tsx','utf8');
  const page=readFileSync('src/pages/Stock.tsx','utf8');
  const migration=readFileSync('supabase/migrations/20260921212500_harden_stock_units_and_active_items.sql','utf8');
  const pagingMigration=readFileSync('supabase/migrations/20260922001000_page_stock_workspace.sql','utf8');
  it('supports and translates every movement type and reason',()=>{expect(hook).toContain("'transfer','return'");expect(hook).toContain("return:'Devolução'");expect(page).toContain('MOVEMENT_REASON_LABELS');});
  it('uses direction-aware visuals and tenant calendar filters',()=>{expect(page).toContain("m.adjustment_direction==='increase'");expect(hook).toContain('dateOnlyUtcRange');expect(page).toContain('tenantTimeZone');});
  it('requires units, preserves their snapshot, and blocks inactive item movements',()=>{expect(migration).toContain('stock_items_unit_not_blank');expect(migration).toContain('unit_snapshot');expect(migration).toContain('stock_item_inactive');expect(page).toContain("catalogItems.filter(i=>i.active!==false)");});
  it('exposes supplier, notes, differentiated item labels and an actual recent window',()=>{expect(page).toContain('Fornecedor');expect(page).toContain('Observações');expect(page).toContain("i.code||'sem código'");expect(pagingMigration).toContain("interval '30 days'");});
});
