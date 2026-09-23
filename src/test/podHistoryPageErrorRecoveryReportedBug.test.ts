import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('POD history later-page recovery',()=>{
  it('keeps retry and previous-page controls reachable when a later page fails',()=>{
    const source=readFileSync('src/pages/PodHistory.tsx','utf8');
    const guard=source.slice(source.indexOf('if(!history)'),source.indexOf('const current=',source.indexOf('if(!history)')));
    expect(guard).toContain('retry={pageQuery.isError?()=>void pageQuery.refetch():undefined}');
    expect(guard).toContain('back={historyPage>1?()=>setHistoryPage');
  });
});
