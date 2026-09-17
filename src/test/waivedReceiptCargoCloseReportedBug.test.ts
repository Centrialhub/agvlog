import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260917145100_accept_waived_receipts_on_cargo_close.sql', 'utf8');

describe('waived physical receipt cargo closure', () => {
  it('counts only non-terminal receipt states as pending', () => {
    expect(migration).toContain("receipt.physical_status not in('received','waived')");
    expect(migration).not.toContain("receipt.physical_status<>'received'");
  });
});
