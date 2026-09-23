import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('taxonomia de documentos fiscais no portal', () => {
  it('mapeia as abas públicas aos tipos persistidos pelos fluxos atuais', () => {
    const sql = readFileSync('supabase/migrations/20260921130000_map_portal_fiscal_document_types.sql', 'utf8');
    expect(sql).toContain("_document_type = ''nfe'' AND fd.document_type IN (''nfe'', ''inbound'')");
    expect(sql).toContain("_document_type = ''cte'' AND fd.document_type IN (''cte'', ''outbound'')");
  });
});
