import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const hook=readFileSync('src/hooks/usePayables.tsx','utf8'),page=readFileSync('src/pages/Payables.tsx','utf8'),sql=readFileSync('supabase/migrations/20260923132052_finance_audit_manual_title_commands.sql','utf8');
describe('payable edit compare and swap',()=>{
 it('carries the opened revision into the atomic command',()=>{expect(page).toContain('expected_updated_at:originalPayable.current.updated_at');expect(hook).toContain("saveManualTitle(currentTenant.id,user.id,'payable',values,id,expected_updated_at)");expect(sql).toContain("select * into p from public.payables where tenant_id=t and id=identifier for update");expect(sql).toContain("p.updated_at is distinct from nullif(_payload->>'expected_updated_at','')::timestamptz");});
});
