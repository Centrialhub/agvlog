import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('escopo da reversão da associação de recebível', () => {
  it('valida pagamento e vínculo antes de chamar o escritor legado', () => {
    const migration = readFileSync('supabase/migrations/20260922200000_scope_legacy_receivable_reversal.sql', 'utf8');
    const component = readFileSync('src/components/financial/LegacyReceivableAssociation.tsx', 'utf8');
    expect(migration).toContain('existing.id=link and existing.payment_id=payment');
    expect(migration).toContain("raise exception 'finance_legacy_receipt_link_mismatch'");
    expect(migration).toContain("_payload-'payment_id'");
    expect(component).toContain('pending.command.payment_id!==payment');
    expect(component).toContain('payment_id:payment,link_id:data!.active_link');
  });
});
