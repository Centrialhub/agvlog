import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration=readFileSync('supabase/migrations/20260921190003_globally_page_operator_pod_timeline.sql','utf8');

describe('canonical POD timeline global paging',()=>{
  it('merges every collection before applying one limit and offset',()=>{
    const page=readFileSync('src/pages/PodHistory.tsx','utf8');
    expect(migration).toContain('with all_rows as materialized');
    expect(migration).toContain("select 'attempts'::text kind");
    expect(migration).toContain("select 'occurrences'");
    expect(migration.match(/limit _page_size offset \(_page-1\)\*_page_size/g)).toHaveLength(1);
    expect(page).toContain('Object.values(history.totals).reduce((sum,total)=>sum+total,0)');
  });

  it('pins later pages to the first snapshot and collection revision',()=>{
    const page=readFileSync('src/pages/PodHistory.tsx','utf8');
    expect(migration).toContain("'snapshot_at',v_snapshot_at");
    expect(migration).toContain("'collection_revision',encode(sha256");
    expect(migration).toContain("raise exception 'pod_history_changed'");
    expect(page).toContain('_snapshot_at:anchor.snapshotAt,_expected_revision:anchor.revision');
  });
});
