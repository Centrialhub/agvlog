import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('busca literal de acertos de motoristas', () => {
  it('escapa os metacaracteres antes de todos os predicados ILIKE', () => {
    const migration = readFileSync('supabase/migrations/20260922040000_escape_driver_settlement_literal_search.sql', 'utf8');
    expect(migration).toContain("replace(replace(replace(v_q, E'\\\\', E'\\\\\\\\'), '%', E'\\\\%'), '_', E'\\\\_')");
    expect(migration).toContain("ilike v_pattern escape E'\\\\'");
    expect(migration).toContain('<> 6');
  });
});
