import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const page=readFileSync('src/pages/Routes.tsx','utf8');
const migration=readFileSync('supabase/migrations/20260917144700_archive_route_templates.sql','utf8');

describe('route archival preserves operational history',()=>{
  it('archives through an audited RPC and removes direct authenticated delete',()=>{
    expect(page).toContain("rpc('archive_route_template_v1'");
    expect(page).not.toContain("from('route_templates').delete()");
    expect(migration).toContain('set enabled=false');
    expect(migration).toContain("'archive_route_template_v1'");
    expect(migration).toContain('revoke delete on table public.route_templates from authenticated');
    expect(migration).not.toContain('delete from public.route_templates');
  });
});
