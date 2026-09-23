import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync(
  'supabase/migrations/20260922016000_validate_assisted_address_candidate.sql',
  'utf8',
);

describe('assisted address candidate validation', () => {
  it('locks the queue before requiring every asserted field to match a stored candidate', () => {
    const lock = migration.indexOf('for update;');
    const candidateCheck = migration.indexOf("if v_kind='assisted_candidate' and not exists(");

    expect(lock).toBeGreaterThan(-1);
    expect(candidateCheck).toBeGreaterThan(lock);
    expect(migration).toContain("jsonb_typeof(v_item.candidates)='array'");
    expect(migration).toContain("candidate.value->>'latitude')::double precision=v_lat");
    expect(migration).toContain("candidate.value->>'longitude')::double precision=v_lng");
    expect(migration).toContain("candidate.value->>'provider'=v_provider");
    expect(migration).toContain("candidate.value->>'accuracy_m')::double precision is not distinct from v_accuracy");
    expect(migration).toContain("candidate.value->>'confidence')::double precision is not distinct from v_confidence");
    expect(migration).toContain("candidate.value->>'label'=v_label");
    expect(migration).toContain("raise exception 'address_assisted_candidate_mismatch' using errcode='22023'");
  });
});
