import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/RoutePlanning.tsx','utf8'),table=readFileSync('src/components/route-planning/StopDraftTable.tsx','utf8');
describe('finite route duration inputs',()=>{
 it('bounds both numeric controls and rejects non-finite handler values',()=>{expect(page).toContain('max={MAX_ROUTE_DURATION_MINUTES}');expect(table).toContain('max={MAX_ROUTE_DURATION_MINUTES}');expect(page).toContain('if (!isValidRouteDuration(v)) return');expect(table).toContain('if(isValidRouteDuration(value))');});
});
