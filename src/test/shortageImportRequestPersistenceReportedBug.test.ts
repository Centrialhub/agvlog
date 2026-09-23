import {readFileSync} from 'node:fs';
import {describe,expect,it} from 'vitest';

describe('shortage import request persistence regression',()=>{
 it('reuses one request id while retrying the same preview fingerprint',()=>{
  const source=readFileSync('src/pages/MerchandiseShortages.tsx','utf8');
  const commit=source.slice(source.indexOf('const commitImport'),source.indexOf('const exportPdf'));
  expect(commit).toContain('importRequestRef.current?.fingerprint !== previewFingerprint');
  expect(commit).toContain('_request_id: requestId');
  expect(commit).not.toContain('_request_id: crypto.randomUUID()');
  expect(commit.indexOf('importRequestRef.current = null')).toBeGreaterThan(commit.indexOf('if (error) throw error'));
 });
});
