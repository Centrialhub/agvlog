import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/Routes.tsx','utf8');

describe('bounded monitored-route screen reads',()=>{
  it('pages templates and scopes dependent collections to the current page',()=>{
    expect(page).not.toContain('fetchAllPostgrestPages');
    expect(page).toContain('const [page,setPage]=useState(1);const pageSize=25');
    expect(page.match(/\.in\('route_id',routeIds\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('&&dialogOpen');
    expect(page).toContain('<DataPagination');
    expect(page).toContain('.limit(1000)');
  });
});
