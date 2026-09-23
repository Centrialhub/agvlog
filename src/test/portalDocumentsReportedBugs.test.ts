import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('contratos do portal de documentos', () => {
  it('mantém o mock no contrato paginado atual', () => {
    const test = readFileSync('src/test/PortalDocumentsFilters.test.tsx', 'utf8');
    expect(test).toContain('data: { rows, hasMore:');
  });

  it('distingue zero financeiro de ausência de valor', () => {
    const page = readFileSync('src/pages/portal/PortalDocuments.tsx', 'utf8');
    expect(page).toContain('d.value != null ? d.value.toLocaleString');
  });

  it('limita tamanho e deslocamento dos dois RPCs privilegiados', () => {
    const sql = readFileSync('supabase/migrations/20260921120500_bound_portal_list_limits.sql', 'utf8');
    expect(sql).toContain('public.list_client_documents_v2');
    expect(sql).toContain('public.search_client_portal_shipments_v2');
    expect(sql).toContain('_limit NOT BETWEEN 1 AND 200');
    expect(sql).toContain('_offset NOT BETWEEN 0 AND 1000000');
  });
});
