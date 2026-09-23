import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260922031000_harden_doccob_cancellation.sql', 'utf8');
const hook = readFileSync('src/hooks/useBillingEdi.tsx', 'utf8');
const page = readFileSync('src/pages/BillingEdi.tsx', 'utf8');

describe('cancelamento consistente de DOCCOB', () => {
  it('bloqueia e valida a transição antes de atualizar', () => {
    expect(migration).toContain('for update');
    expect(migration).toContain("target.status not in ('generated', 'downloaded', 'error')");
    expect(migration).toContain("raise exception 'doccob_export_not_found'");
    expect(migration).toContain("raise exception 'doccob_export_not_cancelable'");
  });

  it('normaliza e exige motivo significativo no cliente e no servidor', () => {
    expect(migration).toContain('normalized_reason text := btrim(_reason)');
    expect(migration).toContain('not between 5 and 1000');
    expect(hook).toContain('const reason = input.reason.trim()');
    expect(page).toContain('reason.trim().length < 5 || cancel.isPending');
  });

  it('não oferece cancelamento para arquivo enviado ou já cancelado', () => {
    expect(page).toContain("disabled={ex.status === 'cancelled' || ex.status === 'sent'}");
  });
});
