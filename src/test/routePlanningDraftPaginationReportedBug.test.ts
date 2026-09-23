import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const source=readFileSync('src/hooks/useRoutePlanningDrafts.tsx','utf8');
describe('route planning draft pagination',()=>{
 it('hydrates every active draft through stable explicit PostgREST ranges',()=>{
  expect(source).toContain('fetchAllPostgrestPages<RoutePlanningDraft>');
  expect(source).toContain('ROUTE_PLANNING_DRAFT_PAGE_SIZE = 200');
  expect(source).toContain(".order('updated_at', { ascending: false })");
  expect(source).toContain(".order('id')");
  expect(source).toContain('.range(from,to)');
  expect(source).not.toContain(".select('*')\n        .eq('tenant_id', currentTenant.id)");
 });
});
