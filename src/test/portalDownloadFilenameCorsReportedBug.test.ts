import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('portal download filename CORS regression',()=>{
 it('exposes the server-selected content disposition to browser JavaScript',()=>{
  const cors=readFileSync('supabase/functions/_shared/cors.ts','utf8');
  const handler=readFileSync('supabase/functions/portal-download-file/index.ts','utf8');
  expect(cors).toContain('"Access-Control-Expose-Headers": "Content-Disposition"');
  expect(handler).toContain("'Content-Disposition': `attachment; filename=\"");
 });
});
