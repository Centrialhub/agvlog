import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('operations dashboard bounded server summary',()=>{
  const page=readFileSync('src/pages/OperationsDashboard.tsx','utf8');
  const hook=readFileSync('src/hooks/useOperationsDashboard.ts','utf8');
  const migration=readFileSync('supabase/migrations/20260922005000_operations_dashboard_summary.sql','utf8');
  it('replaces broad catalog hooks with one aggregate query and bounded samples',()=>{expect(page).toContain('useOperationsDashboardSummary');expect(page).not.toContain('useOrders()');expect(page).not.toContain('useLoads()');expect(page).not.toContain('useIncidents()');expect(migration).toContain('limit 8');expect(hook).toContain('operations_dashboard_summary_v1');});
  it('derives overdue orders from the tenant civil day and returns stable day counts',()=>{expect(migration).toContain("statement_timestamp() at time zone v_timezone");expect(migration).toContain('(v_today-orders.promised_date) days_overdue');expect(page).toContain("o.days_overdue===1?'há 1 dia'");expect(page).not.toContain("promised_date + 'T23:59:59'");});
});
