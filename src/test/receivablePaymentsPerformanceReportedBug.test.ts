import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('custo da página de recebimentos', () => {
  it('materializa o histórico uma vez para revisão, total e recorte', () => {
    const migration = readFileSync('supabase/migrations/20260922049000_reuse_receivable_payment_history_rows.sql', 'utf8');
    expect(migration.match(/finance_private\.receivable_payment_page_rows\(/g)).toHaveLength(1);
    expect(migration).toContain('all_rows as materialized');
    expect(migration).toContain('numbered as materialized');
    expect(migration).toContain('filter(where ordinal>page_start and ordinal<=page_start+50)');
  });
});
