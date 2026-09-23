import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260922021000_audit_operational_route_material_edits.sql',
  'utf8',
);

describe('operational route material edit audit', () => {
  it('replaces name-only auditing with a complete actor-stamped version record', () => {
    expect(migration).toContain('drop trigger if exists trg_operational_routes_audit_name');
    for (const field of ['name', 'description', 'classification', 'destinations', 'region_name', 'active', 'periodicity_default']) {
      expect(migration).toContain(`old.${field}`);
      expect(migration).toContain(`new.${field}`);
    }
    expect(migration).toContain('new.updated_by:=auth.uid()');
    expect(migration).toContain('new.updated_at:=clock_timestamp()');
    expect(migration).toContain('to_jsonb(old)');
    expect(migration).toContain("to_jsonb(new)||jsonb_build_object('_changed_fields'");
    expect(migration).toContain("auth.uid(),'operational_route_editor'");
  });
});
