import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917145200_page_operator_pod_history.sql', 'utf8');
const page = readFileSync('src/pages/PodHistory.tsx', 'utf8');

describe('bounded operator POD history', () => {
  it('bounds every historical collection in a dedicated page RPC', () => {
    expect(migration).toContain('get_operator_pod_history_collections_v1');
    expect(migration.match(/limit _page_size offset \(_page-1\)\*_page_size/g)).toHaveLength(5);
    expect(migration).toContain('v_collections:=public.get_operator_pod_history_collections_v1(_tenant_id,_document_id,1,25)');
  });

  it('loads later pages only when requested and renders bounded navigation', () => {
    expect(page).toContain("queryKey:['pod-history-collections'");
    expect(page).toContain('enabled:!!query.data&&historyPage>1');
    expect(page).toContain('setHistoryPage(page=>page+1)');
  });
});
