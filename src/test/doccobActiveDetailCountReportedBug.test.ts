import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260922028000_count_only_active_doccob_details.sql', 'utf8');

describe('contagem de detalhes ativos do DOCCOB', () => {
  it('alinha a validação do payload e do conteúdo ao conjunto de cobranças não canceladas', () => {
    expect(migration).toContain('charge.id=detail.charge_id AND charge.invoice_id=detail.invoice_id');
    expect(migration).toContain('charge.cancelled_at IS NULL');
    expect(migration).toContain('charge.id=detail.charge_id and charge.invoice_id=detail.invoice_id');
    expect(migration).toContain('charge.cancelled_at is null');
    expect(migration).not.toMatch(/register_new text := '[^']*client_invoice_details[^']*cancelled_at IS NULL[^']*client_invoice_details/);
  });
});
