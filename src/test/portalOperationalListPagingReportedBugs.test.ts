import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const read = (path: string) => readFileSync(resolve(path), 'utf8');
const pickups = read('src/hooks/portal/usePortalPickups.ts');
const pods = read('src/hooks/portal/usePortalPods.ts');
const occurrences = read('src/hooks/portal/usePortalOccurrences.ts');
const migration = read('supabase/migrations/20260917152100_page_portal_operational_lists.sql');

describe('reported portal operational list paging bugs', () => {
  it('loads pickups, PODs and occurrences incrementally instead of exhausting every page', () => {
    for (const source of [pickups, pods, occurrences]) {
      expect(source).toContain('useInfiniteQuery');
      expect(source).toContain('PORTAL_LIST_PAGE_SIZE');
      expect(source).toContain('getNextPageParam: nextPortalListPage');
      expect(source).not.toContain('fetchAllPostgrestPages');
    }
  });

  it('uses a bounded server page for each portal list', () => {
    expect(migration.match(/least\(greatest\(coalesce\(_page_size, 50\), 1\), 100\)/g)).toHaveLength(3);
    expect(migration).toContain('list_client_pickups_page_v1');
    expect(migration).toContain('list_client_pods_page_v1');
    expect(migration).toContain('list_client_occurrences_page_v1');
  });

  it('pins POD and occurrence continuations to a snapshot, unique cursor and collection revision', () => {
    expect(migration.match(/portal_list_snapshot_changed/g)).toHaveLength(3);
    expect(migration).toContain("jsonb_build_object('received_at', v.sort_received_at, 'created_at', v.sort_created_at, 'id', v.id)");
    expect(migration).toContain("jsonb_build_object('created_at', v.created_at, 'id', v.id)");
    expect(pods).toContain('_expected_revision: pageParam?.revision');
    expect(occurrences).toContain('_expected_revision: pageParam?.revision');
  });
});
