import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/ProductivityReports.tsx','utf8'),migration=readFileSync('supabase/migrations/20260922011000_productivity_report_summary.sql','utf8');
describe('productivity catalog and filters',()=>{
 it('includes inactive historical vehicles',()=>{expect(page).toContain('useProductivityReportSummary(filters)');expect(migration).toContain('from public.vehicles v left join load_totals');expect(migration).not.toMatch(/v\.active\s*(?:=|is)/);});
 it('clears tenant-specific driver and vehicle filters',()=>{expect(page).toContain("next.delete('f_driver')");expect(page).toContain("next.delete('f_vehicle')");expect(page).toMatch(/\[currentTenant\?\.id,\s*setSearchParams\]/);});
 it('keeps full driver names on the chart',()=>{expect(page).toContain('name: row.name');expect(page).not.toContain("name.split(' ')[0]");});
});
