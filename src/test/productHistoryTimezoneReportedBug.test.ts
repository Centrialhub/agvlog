import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const page=readFileSync('src/pages/ProductHistory.tsx','utf8');
const dateUtils=readFileSync('src/lib/utils/formatDate.ts','utf8');
const migration=readFileSync('supabase/migrations/20260922008000_use_tenant_timezone_for_product_history.sql','utf8');

describe('tenant timezone product history',()=>{
  it('formats returned instants in the tenant timezone',()=>{
    expect(page).toContain('fmtDateTimeInTimeZone');expect(page).toContain('currentTenant?.timezone');expect(dateUtils).toContain("timeZone, day: '2-digit'");
  });
  it('replaces the fixed SQL timezone in the canonical history function',()=>{
    expect(migration).toContain("replace(v_definition,'''America/Sao_Paulo''','v_timezone')");expect(migration).toContain('select tenant.timezone from public.tenants');expect(migration).toContain('product_history_timezone_anchor_not_found');
  });
});
