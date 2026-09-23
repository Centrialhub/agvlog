import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('escopo do selo de ocorrência nas próximas entregas', () => {
  it('correlaciona por documento ou por cliente e carga do próprio documento', () => {
    const sql = readFileSync('supabase/migrations/20260921124500_scope_portal_delivery_occurrences.sql', 'utf8');
    expect(sql).toContain('oo.tenant_id = fd.tenant_id');
    expect(sql).toContain('oo.fiscal_document_id = fd.id');
    expect(sql).toContain('oo.client_id = fd.client_id AND oo.load_id = fd.load_id');
    expect(sql).toContain("execute replace(body, needle, replacement)");
  });
});
