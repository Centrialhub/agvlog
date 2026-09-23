import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('catálogo de entradas para recebimento legado', () => {
  it('calcula o saldo usado uma vez e reutiliza catálogo e histórico', () => {
    const migration = readFileSync('supabase/migrations/20260922201000_reuse_legacy_receivable_catalog.sql', 'utf8');
    expect(migration.match(/finance_private\.receipt_movement_used_cents\(/g)).toHaveLength(1);
    expect(migration).not.toContain('legacy_receivable_catalog_revision(');
    expect(migration).toContain('movement_capacity as materialized');
    expect(migration).toContain('candidates as materialized');
    expect(migration).toContain('history as materialized');
  });
});
