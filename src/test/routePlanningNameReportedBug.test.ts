import{readFileSync}from'node:fs';import{describe,expect,it}from'vitest';
const page=readFileSync('src/pages/RoutePlanning.tsx','utf8'),save=readFileSync('src/hooks/useRoutePlanningDrafts.tsx','utf8'),dispatch=readFileSync('src/hooks/route-planning/useDispatchRoutePlan.ts','utf8'),migration=readFileSync('supabase/migrations/20260922012000_require_planning_route_names.sql','utf8'),hardening=readFileSync('supabase/migrations/20260923144654_require_nonempty_planned_trip_names.sql','utf8');
describe('route planning names',()=>{
 it('normalizes whitespace before local creation, autosave, and dispatch',()=>{expect(page).toContain('newRouteName.trim() ||');expect(save).toContain('const normalizedName=name.trim()');expect(dispatch).toContain('const routeName=payload.route_name.trim()');expect(dispatch).toContain('route_name: routeName');});
 it('enforces the invariant at both database write boundaries',()=>{expect(migration).toContain("new.name:=nullif(btrim(new.name),'')");expect(hardening).toContain("if new.status = 'planned' then");expect(hardening).toContain("new.notes := nullif(btrim(new.notes), '')");expect(hardening).toContain("raise exception 'route_name_required'");});
});
