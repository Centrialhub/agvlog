import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('auditoria da exclusão de acertos', () => {
  it('valida a justificativa e preserva acerto, vínculos, eventos e pagamentos antes da exclusão', () => {
    const migration = readFileSync('supabase/migrations/20260922042000_audit_driver_settlement_deletion.sql', 'utf8');
    expect(migration).toContain('deletion_reason_required');
    expect(migration).toContain("'driver_settlement_delete'");
    for (const relation of ['driver_settlement_loads', 'driver_settlement_items', 'driver_settlement_events', 'driver_settlement_payments']) {
      expect(migration).toContain(`public.${relation}`);
    }
    expect(migration.indexOf('perform public._log_entity_audit')).toBeLessThan(migration.lastIndexOf('-- Loads are linked canonically'));
    expect(migration).toContain("jsonb_build_object('reason', v_reason)");
  });
});
