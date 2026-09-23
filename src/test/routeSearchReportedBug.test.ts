import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260921180114_search_route_templates_page.sql', 'utf8');
const page = readFileSync('src/pages/Routes.tsx', 'utf8');

describe('route catalog search', () => {
  it('searches route names, corridor geofences and waypoint labels before paging', () => {
    expect(migration).toContain('rt.name ilike v_pattern');
    expect(migration).toContain('g.name ilike v_pattern');
    expect(migration).toContain('rw.label ilike v_pattern');
    expect(migration).toMatch(/order by rt\.created_at desc, rt\.id[\s\S]*limit _page_limit offset v_offset/);
  });

  it('uses the relational server reader from the corridor screen', () => {
    expect(page).toContain("rpc('list_operator_routes_page_v1'");
    expect(page).not.toContain("query.ilike('name'");
  });
});
