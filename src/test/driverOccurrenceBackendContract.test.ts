import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/20260830013356_harden_driver_occurrence_scope.sql'),
  'utf8',
);
const loadScopeMigration = readFileSync(
  resolve('supabase/migrations/20260831232156_remove_trip_load_from_unscoped_driver_occurrences.sql'),
  'utf8',
);

describe('driver occurrence database hardening', () => {
  it('treats a null stop as trip scope without a pending-stop fallback', () => {
    expect(migration).toContain("'scope', case when _stop_id is null then 'trip' else 'stop' end");
    expect(migration).not.toMatch(/if\s+v_stop\s+is\s+null[\s\S]*dispatch_stops/i);
    expect(migration).not.toMatch(/status\s+not\s+in[\s\S]*stop_terminal_statuses/i);
  });

  it('keeps every driver-created occurrence internal by default', () => {
    expect(migration).toMatch(/false,\s*false,\s*'reported_by_driver'/);
    expect(migration).toContain('case when count(*) = 1');
    expect(migration).not.toContain('0cff2aa3-2aca-431d-ad7d-26367b6f48c2');
  });

  it('also removes the implicit load from a null-stop occurrence', () => {
    expect(loadScopeMigration).toContain('v_load := null');
    expect(loadScopeMigration).toContain('without stop, client, load, or fiscal-document associations');
    expect(loadScopeMigration).toMatch(/false,\s*false,\s*'reported_by_driver'/);
  });

  it('repairs the known historical residue with strict, description-free audit evidence', () => {
    expect(loadScopeMigration).toContain("v_event_id constant uuid := '0cff2aa3-2aca-431d-ad7d-26367b6f48c2'");
    expect(loadScopeMigration).toContain("v_expected_load_id constant uuid := '585c92b4-cad8-468b-a2b0-8c08c2dcd849'");
    expect(loadScopeMigration).toContain("pg_catalog.md5(coalesce(v_event.description, '')) <> '17d4bc0884d69d4b581c8d84890cb84b'");
    expect(loadScopeMigration).toContain("'driver_occurrence_load_scope_repair'");
    expect(loadScopeMigration).toContain("jsonb_build_object('load_id', v_event.load_id)");
    expect(loadScopeMigration).toContain("jsonb_build_object('load_id', null)");
    expect(loadScopeMigration).toContain('Historical occurrence precondition failed');
  });

  it('pins the privileged function context and exposes only the intended roles', () => {
    for (const sql of [migration, loadScopeMigration]) {
      expect(sql).toMatch(/security definer\r?\nset search_path = ''/);
      expect(sql).toMatch(/from public, anon, authenticated, service_role;/);
      expect(sql).toMatch(/to authenticated, service_role;/);
    }
  });
});
