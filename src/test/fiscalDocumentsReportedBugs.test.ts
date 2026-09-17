import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { assertFiscalDocumentIdentity } from '@/lib/fiscalDocuments/fiscalDocumentIdentity';

const hookSource = readFileSync('src/hooks/useFiscalDocuments.tsx', 'utf8');
const pageSource = readFileSync('src/pages/FiscalDocuments.tsx', 'utf8');
const searchMigration = readFileSync('supabase/migrations/20260917125000_complete_fiscal_document_search.sql', 'utf8');

describe('reported fiscal control regressions', () => {
  it('does not keep actionable rows from the previous page or filters', () => {
    const pageHook = hookSource.match(/export function useFiscalDocumentsPage[\s\S]*?\n}\n\nexport function useFiscalDocumentSummary/)?.[0] ?? '';
    expect(pageHook).not.toContain('placeholderData');
  });

  it('searches client names in the paged database query without a 100-client cap', () => {
    expect(hookSource).toContain("rpc('get_fiscal_documents_page_v1'");
    expect(searchMigration).toContain("c.company_name ilike '%' || btrim(_search) || '%'");
    expect(searchMigration).not.toContain('limit(100)');
  });

  it('does not expose arbitrary status transitions and rejects status through the generic update hook', () => {
    expect(pageSource).not.toContain('onStatusChange');
    expect(pageSource).toContain('Alterações de status são feitas pelos comandos operacionais e fiscais correspondentes');
    expect(hookSource).toContain("hasOwnProperty.call(values, 'status')");
  });

  it('requires a valid access key or a minimum composite fiscal identity', () => {
    expect(() => assertFiscalDocumentIdentity({})).toThrow(/número, data de emissão/);
    expect(() => assertFiscalDocumentIdentity({ access_key: '123' })).toThrow(/44 dígitos/);
    expect(() => assertFiscalDocumentIdentity({
      invoice_number: '123', issue_date: '2026-09-17', recipient: 'Cliente',
    })).not.toThrow();
    expect(() => assertFiscalDocumentIdentity({ access_key: '1'.repeat(44) })).not.toThrow();
  });

  it('uses synchronous locks in both the form and creation hook', () => {
    expect(pageSource).toContain('if (submitLock.current || saving || catalogsLoading || catalogsError) return');
    expect(pageSource).toContain('disabled={saving || submitting || catalogsLoading || catalogsError}');
    expect(hookSource).toContain('if (submissionLock.current)');
    expect(hookSource).toContain('submissionLock.current = true');
    expect(hookSource).toContain('submissionLock.current = false');
  });
});
