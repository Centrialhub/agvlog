import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('agrupamento da realocação de cargas', () => {
  const source = readFileSync('src/pages/LoadReallocation.tsx', 'utf8');

  it('usa remetente quando não existe destinatário e sempre mostra seu resumo', () => {
    expect(source).toContain("meta?.remitter ? `[FORN: ${meta.remitter}] ${client}` : client");
    expect(source).toContain('recipientsSummary.remitters.length > 0 || recipientsSummary.recipients.length > 0');
  });

  it('separa notas homônimas pela identidade fiscal', () => {
    expect(source).toContain('`INV-${item.fiscal_document_id || item.id}-${invoice}`');
  });

  it('soma o valor integral uma única vez por documento', () => {
    expect(source).toContain('countedDocuments: new Set<string>()');
    expect(source).toContain('!acc[key].countedDocuments.has(documentId)');
    expect(source).toContain('acc[key].countedDocuments.add(documentId)');
  });

  it('limita o catálogo com busca e paginação remotas antes de consultar metadados', () => {
    expect(source).toContain('useLoadsPage({');
    expect(source).toContain('pageSize: REALLOCATION_LOAD_PAGE_SIZE');
    expect(source).toContain('statuses: REALLOCATION_ACTIVE_STATUSES');
    expect(source).toContain('Buscar cargas ativas');
    expect(source).toContain('setCatalogPage((page) => Math.min(catalogPages, page + 1))');
  });
});
