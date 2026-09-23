import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('driver monitoring cross-page metrics',()=>{
 it('uses a complete paged reader for KPIs and whole-filter exports',()=>{
  const hook=readFileSync('src/hooks/useDriverMonitoring.tsx','utf8');
  const page=readFileSync('src/pages/DriverMonitoring.tsx','utf8');
  expect(hook).toContain('useDriverMonitorsReport');expect(hook).toContain('fetchAllPostgrestPages');
  expect(page).toContain('for (const r of reportRows)');expect(page).toContain('driversInRouteCsv(activeReportRows)');
  expect(page).toContain('productivityPdf(reportRows');
 });
});
