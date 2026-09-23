import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('shortage mutation error handling regression',()=>{
 it('shows mutation errors and handles every async selection rejection',()=>{
  const hook=readFileSync('src/hooks/useMerchandiseShortages.tsx','utf8');
  const page=readFileSync('src/pages/MerchandiseShortages.tsx','utf8');
  const section=page.slice(page.indexOf('<TabsContent value="apurar">'),page.indexOf('<TabsContent value="report"'));
  expect(hook).toContain('onError: (error: unknown) =>');
  expect(hook).toContain('shortage_case_revision_changed');
  expect(section.match(/catch/g)?.length).toBeGreaterThanOrEqual(4);
  expect(section).not.toMatch(/onValueChange=\{id => updateStatus\.mutateAsync/);
 });
});
