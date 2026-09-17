import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260917150500_require_active_occurrence_responsible.sql',
  'utf8',
);

describe('occurrence import responsible membership', () => {
  it('requires the responsible user membership to be active in the batch tenant', () => {
    expect(migration).toContain('membership.tenant_id = t');
    expect(migration).toContain('membership.user_id = x.responsible_user_id');
    expect(migration).toContain('membership.active = true');
    expect(migration).toContain('responsible_user_not_active_in_tenant');
  });
});
