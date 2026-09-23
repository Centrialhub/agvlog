import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('account period evidence receipt count regression',()=>{
 it('computes receipt totals from the integral snapshot and avoids local paging of a server page',()=>{
  const migration=readFileSync('supabase/migrations/20260922038000_summarize_full_period_movement_receipts.sql','utf8');
  const panel=readFileSync('src/components/financial/AccountPeriodEvidenceIndexPanel.tsx','utf8');
  expect(migration).toContain("'movement_receipt_summary',jsonb_build_object");
  expect(migration.match(/c\.snapshot#>'\{facts,movements\}'/g)?.length).toBeGreaterThanOrEqual(2);
  expect(panel).toContain('data.movement_receipt_summary?.identified');
  expect(panel).toContain('use a paginação de movimentos preservados');
  expect(panel).toContain('{!paged&&<Pager name="Documentos preservados"');
 });
});
