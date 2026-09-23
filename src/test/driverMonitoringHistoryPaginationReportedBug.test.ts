import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('driver monitoring history pagination',()=>{
 it('loads every update and forecast page and uses all filtered monitor ids',()=>{
  const hook=readFileSync('src/hooks/useDriverMonitoring.tsx','utf8');
  const page=readFileSync('src/pages/DriverMonitoring.tsx','utf8');
  expect(hook).not.toContain(".limit(200)");
  expect(hook).toContain('start<uniqueIds.length;start+=100');
  expect(hook.match(/fetchAllPostgrestPages<.*QueryRow>/g)?.length).toBeGreaterThanOrEqual(4);
  expect(page).toContain('useMonitorForecasts(reportRows.map');
 });
});
