import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('route archive optimistic concurrency',()=>{
  it('advances the route revision once when archiving',()=>{
    const migration=readFileSync('supabase/migrations/20260921191241_bump_route_revision_on_archive.sql','utf8');
    expect(migration).toContain('set enabled=false,revision=revision+1,updated_at=clock_timestamp()');
    expect(migration).toContain('if not v_route.enabled then');
    expect(migration).toContain("'revision',v_route.revision");
  });
});
