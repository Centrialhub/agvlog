import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('MDF-e nos documentos do portal', () => {
  it('roteia a aba para o agregado fiscal atual e preserva o escopo do cliente', () => {
    const hook = readFileSync('src/hooks/portal/usePortalDocuments.ts', 'utf8');
    const page = readFileSync('src/pages/portal/PortalDocuments.tsx', 'utf8');
    const sql = readFileSync('supabase/migrations/20260921130500_list_portal_mdfe_documents.sql', 'utf8');
    expect(hook).toContain("filters?.document_type === 'mdfe'");
    expect(hook).toContain("supabase.rpc('list_client_mdfe_documents_v1'");
    expect(sql).toContain('from public.load_manifests m');
    expect(sql).toContain('fd.client_id in (select allowed.id from allowed)');
    expect(sql).toContain('m.external_id is not null');
    expect(page).toContain("d.document_type === 'mdfe'");
  });
});
