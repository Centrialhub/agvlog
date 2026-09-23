import { describe,expect,it } from 'vitest';
import { readFileSync } from 'node:fs';

const page=readFileSync('src/pages/ProductivityReports.tsx','utf8');
const hook=readFileSync('src/hooks/useProductivityReport.ts','utf8');
const migration=readFileSync('supabase/migrations/20260922011000_productivity_report_summary.sql','utf8');

describe('productivity report bounded server summary',()=>{
  it('replaces full history/catalog downloads with one filtered aggregate RPC',()=>{
    expect(page).toContain('useProductivityReportSummary(filters)');
    expect(page).not.toMatch(/useLoads|useOperationalEvents|useClients|useVehicles|useDrivers|matchesDateRange/);
    expect(hook).toContain("supabase.rpc('productivity_report_summary_v1'");
    expect(hook).toContain("_from:filters.from||null");
    expect(hook).toContain("_to:filters.to||null");
  });
  it('filters in the tenant civil timezone and bounds aggregate groups and options',()=>{
    expect(migration).toContain('(l.created_at at time zone v_timezone)::date>=_from');
    expect(migration).toContain('(e.created_at at time zone v_timezone)::date<=_to');
    expect(migration.match(/limit 100/g)?.length).toBe(3);
    expect(migration.match(/limit 500/g)?.length).toBe(2);
    expect(migration).toContain('is_tenant_operator_or_admin(_tenant_id)');
  });
  it('paginates all three rendered aggregate tables',()=>{
    expect(page.match(/<DataPagination/g)?.length).toBe(3);
    expect(page.match(/pageSize: 20/g)?.length).toBe(3);
  });
});
