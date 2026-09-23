import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/Routes.tsx','utf8');

describe('bounded monitored-route screen reads',()=>{
  it('pages templates and completely reads dependent collections scoped to the current page',()=>{
    expect(page).toContain('fetchAllPostgrestPages');
    expect(page).toContain('const [page,setPage]=useState(1);const pageSize=25');
    expect(page.match(/\.in\('route_id',routeIds\)/g)?.length).toBeGreaterThanOrEqual(2);
    expect(page).toContain('&&dialogOpen');
    expect(page).toContain('<DataPagination');
    expect(page).not.toContain('.limit(1000)');
    expect(page.match(/\.range\(from,to\)/g)?.length).toBeGreaterThanOrEqual(4);
  });
});
