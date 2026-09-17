import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917144900_fix_employee_contract_boundary.sql', 'utf8');

describe('employee contract inclusive date boundaries', () => {
  it('closes a replaced active contract on the preceding day', () => {
    expect(migration).toContain('end_date = v_start - 1');
    expect(migration).not.toContain('end_date = v_start,');
  });

  it('rejects a replacement that cannot produce a valid preceding interval', () => {
    expect(migration).toContain('start_date >= v_start');
    expect(migration).toContain("raise exception 'contract_start_must_follow_active_contract'");
  });

  it('repairs the exact one-day overlap already created by the old command', () => {
    expect(migration).toContain('ordered.end_date = ordered.next_start_date');
    expect(migration).toContain('set end_date = ordered.next_start_date - 1');
  });
});
