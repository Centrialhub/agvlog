import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('portal next-page conflict recovery regression',()=>{
 for(const name of ['PortalPickups','PortalPods','PortalOccurrences']){
  it(`${name} keeps loaded rows visible when only the next page conflicts`,()=>{
   const source=readFileSync(`src/pages/portal/${name}.tsx`,'utf8');
   expect(source).toContain('error && !isFetchNextPageError');
   expect(source).toContain("'A lista mudou — atualizar'");
  });
 }

 it('does not suppress the POD recovery control merely because next-page error is set',()=>{
  const source=readFileSync('src/pages/portal/PortalPods.tsx','utf8');
  expect(source).toContain('{(hasNextPage || isFetchNextPageError) && (');
  expect(source).not.toContain('(hasNextPage || isFetchNextPageError) && !error');
 });
});
