import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('datas civis dos acertos de motoristas', () => {
  it('reaplica os limites de São Paulo depois da versão paginada da RPC', () => {
    const migration = readFileSync('supabase/migrations/20260922041000_restore_driver_settlement_civil_date_filters.sql', 'utf8');
    expect(migration).toContain("_date_from::timestamp at time zone ''America/Sao_Paulo''");
    expect(migration).toContain("(_date_to + 1)::timestamp at time zone ''America/Sao_Paulo''");
    expect(migration).toContain('driver_settlement_civil_date_predecessor_changed');
  });
});
