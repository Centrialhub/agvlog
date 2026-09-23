import { readFileSync } from 'node:fs';
import { describe,expect,it } from 'vitest';

const page=readFileSync('src/pages/ProductTraceability.tsx','utf8');

describe('product traceability document filters',()=>{
  it('excludes soft-deleted fiscal documents before applying document filters',()=>{
    expect(page).toContain("q.is('fiscal_documents.deleted_at', null)");
    expect(page).toContain("fiscal_documents${filterDocument ? '!inner' : ''}");
  });
  it('escapes SQL wildcard characters in every free-text ilike filter',()=>{
    expect(page).toContain('escapeIlikeLiteral');
    expect(page.match(/escapeIlikeLiteral\(/g)?.length).toBe(4);
    expect(page).not.toContain("split('').join('%')");
  });
});
