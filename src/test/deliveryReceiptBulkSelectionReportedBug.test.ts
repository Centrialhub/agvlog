import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

describe('delivery receipt bulk selection refresh',()=>{
 it('always reloads the disabled complete query and clears stale selections after mutations',()=>{
  const source=readFileSync('src/pages/DeliveryReceipts.tsx','utf8');
  expect(source).toContain('const complete=(await allFiltered.refetch()).data');
  expect(source).not.toContain('allFiltered.data??(await allFiltered.refetch()).data');
  expect(source.match(/setSelected\(\[\]\)/g)?.length).toBeGreaterThanOrEqual(4);
 });
});
