import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('integridade ao anexar romaneios a acertos manuais', () => {
  it('bloqueia os romaneios e rejeita motorista diferente dentro da RPC', () => {
    const migration = readFileSync(
      'supabase/migrations/20260922043000_enforce_settlement_load_driver_identity.sql',
      'utf8',
    );
    expect(migration).toContain('where l.id = any (_load_ids)');
    expect(migration).toContain('for update;');
    expect(migration).toContain('l.driver_id is distinct from v_s.driver_id');
    expect(migration).toContain("raise exception 'load_driver_mismatch'");
  });

  it('não audita remoção quando o romaneio não estava vinculado', () => {
    const migration = readFileSync(
      'supabase/migrations/20260922044000_reject_missing_settlement_load_detach.sql',
      'utf8',
    );
    const rowCount = migration.indexOf('get diagnostics v_deleted = row_count');
    const rejection = migration.indexOf("raise exception 'settlement_load_not_found'");
    const audit = migration.indexOf("'load_detached'");
    expect(rowCount).toBeGreaterThan(-1);
    expect(rejection).toBeGreaterThan(rowCount);
    expect(audit).toBeGreaterThan(rejection);
  });

  it('deduplica pedidos e audita somente vínculos realmente inseridos', () => {
    const migration = readFileSync(
      'supabase/migrations/20260922045000_count_actual_settlement_load_attachments.sql',
      'utf8',
    );
    expect(migration).toContain('array_agg(distinct requested.load_id');
    expect(migration).toContain('get diagnostics v_row_count = row_count');
    expect(migration).toContain("raise exception 'loads_already_attached'");
    expect(migration).toContain("jsonb_build_object('count', v_inserted)");
    expect(migration).not.toContain("jsonb_build_object('count', array_length(_load_ids");
  });
});
