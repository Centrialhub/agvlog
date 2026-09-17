import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917145900_lock_xml_revert_dispatch_graph.sql',
  'utf8',
);

describe('XML-load revert concurrency barrier', () => {
  it('moves the mutation implementation behind a non-executable private helper', () => {
    expect(migration).toContain('set schema private');
    expect(migration).toContain('revert_xml_loads_to_available_unsafe_20260917');
    expect(migration).toContain('revoke all on function private.revert_xml_loads_to_available_unsafe_20260917');
  });

  it('locks loads before rediscovering and locking their dispatch graph', () => {
    const loadLock = migration.indexOf('from public.loads load');
    const graphRefresh = migration.indexOf('Re-read the links after the load barrier');
    const tripLock = migration.indexOf('from public.dispatch_trips trip', graphRefresh);
    const linkLock = migration.lastIndexOf('from public.dispatch_trip_loads link');

    expect(loadLock).toBeGreaterThan(-1);
    expect(graphRefresh).toBeGreaterThan(loadLock);
    expect(tripLock).toBeGreaterThan(graphRefresh);
    expect(linkLock).toBeGreaterThan(tripLock);
    expect(migration.match(/for update;/g)).toHaveLength(3);
  });

  it('fails rather than mutating a partially changed load set', () => {
    expect(migration).toContain('v_locked <> cardinality(v_load_ids)');
    expect(migration).toContain("using errcode = '40001'");
  });
});
