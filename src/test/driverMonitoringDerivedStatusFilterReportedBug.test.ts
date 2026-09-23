import { describe,expect,it } from 'vitest';
import { matchesDriverMonitorStatusFilters,type DriverMonitorRow } from '@/hooks/useDriverMonitoring';

const row=(status:DriverMonitorRow['status'])=>({status} as DriverMonitorRow);
describe('driver monitor derived status filters',()=>{
 it('filters the calculated row status instead of the persisted database status',()=>{
  expect(matchesDriverMonitorStatusFilters(row('delayed'),{status:'delayed'})).toBe(true);
  expect(matchesDriverMonitorStatusFilters(row('on_time'),{onlyDelayed:true})).toBe(false);
  expect(matchesDriverMonitorStatusFilters(row('no_update'),{onlyNoUpdate:true})).toBe(true);
 });
 it('does not push derived status predicates into the report database query',async()=>{
  const source=await import('node:fs').then(fs=>fs.readFileSync('src/hooks/useDriverMonitoring.tsx','utf8'));
  expect(source).not.toContain("q=q.eq('status'");
 });
});
