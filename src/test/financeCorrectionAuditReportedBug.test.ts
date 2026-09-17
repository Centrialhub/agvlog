import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';
import {financeAuditActions} from '@/lib/financial/financeAuditContract';

const migration=[
 readFileSync('supabase/migrations/20260917151000_make_credit_refund_reversal_idempotent.sql','utf8'),
 readFileSync('supabase/migrations/20260917151100_audit_statement_corrections.sql','utf8'),
].join('\n');

describe('financial correction audit visibility',()=>{
 it('marks both corrections as manual and exposes specific labels',()=>{expect(migration).toContain("'statement_account_reassigned'");expect(migration).toContain("'customer_credit_refund_reversed'");expect(migration.match(/'manual_intervention',true/g)?.length).toBeGreaterThanOrEqual(2);expect(financeAuditActions.statement_account_reassigned).toMatch(/extrato/i);expect(financeAuditActions.customer_credit_refund_reversed).toMatch(/devolução/i);});
 it('writes the canonical statement entity and reads legacy events in history',()=>{expect(migration).toContain("_tenant_id,'statement_import',_import_id");expect(migration.match(/entity_type in\('statement_import','finance_statement_import'\)/g)).toHaveLength(2);});
});
