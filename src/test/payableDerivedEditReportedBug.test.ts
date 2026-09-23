import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';import{isPayableDirectlyEditable}from'@/hooks/usePayables';
const page=readFileSync('src/pages/Payables.tsx','utf8'),portfolio=readFileSync('src/components/financial/PayablePortfolioPanel.tsx','utf8'),migration=readFileSync('supabase/migrations/20260922014000_block_direct_derived_payable_edits.sql','utf8');
describe('derived payable editing boundary',()=>{
 it('allows only standalone titles in the direct editor',()=>{expect(isPayableDirectlyEditable({source_table:null,source_id:null} as never)).toBe(true);expect(isPayableDirectlyEditable({source_table:'payroll_entries',source_id:crypto.randomUUID()} as never)).toBe(false);expect(page).toContain("action==='edit'&&!isPayableDirectlyEditable(data)");expect(portfolio).toContain('Corrija na origem operacional');});
 it('enforces the boundary for raw authenticated updates',()=>{expect(migration).toContain('as restrictive for update to authenticated');expect(migration.match(/source_table is null and source_id is null/g)?.length).toBe(2);});
});
