import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  resolve('supabase/migrations/20260830013356_harden_driver_occurrence_scope.sql'),
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

  it('pins the privileged function context and exposes only the intended roles', () => {
    expect(migration).toContain("security definer\nset search_path = ''");
    expect(migration).toMatch(/from public, anon, authenticated, service_role;/);
    expect(migration).toMatch(/to authenticated, service_role;/);
  });
});
