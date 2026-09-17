import { describe, expect, it } from 'vitest';

describe('bugs 611 a 617 da seleção de NF-es da NFS-e', () => {
  it('treats visible selection as the source of truth and clears linked state at zero', async () => {
    const source = (await import('@/components/nfse/NFSeFormDialog?raw')).default;
    expect(source).toContain('const applyDocumentSelection = (nextIds: Set<string>)');
    expect(source).toContain('if (selected.length === 0)');
    expect(source).toContain('valor_servicos: total');
    expect(source).toContain('const fiscalDocumentIds = [...selectedIds]');
  });

  it('does not rederive saved drafts merely because their linked documents load later', async () => {
    const source = (await import('@/components/nfse/NFSeFormDialog?raw')).default;
    expect(source).not.toMatch(/useEffect\(\(\) => \{\s*if \(selectedIds\.size > 0\)/);
    expect(source).toContain('setSelectedIds(new Set(initial?.fiscal_document_ids ?? []))');
    expect(source).toContain("initial?.items?.map((item)");
  });

  it('rejects mixed takers, preserves edited linked items, and synchronizes item removal', async () => {
    const source = (await import('@/components/nfse/NFSeFormDialog?raw')).default;
    expect(source).toContain("toast.error('Selecione somente NF-es do mesmo tomador.')");
    expect(source).toContain('existingByDocument.get(document.id) ??');
    expect(source).toContain('applyDocumentSelection(next)');
  });

  it('hides deleted, already emitted, and reserved sources before draft creation', async () => {
    const source = (await import('@/components/nfse/NFSeFormDialog?raw')).default;
    expect(source).toContain(".is('deleted_at', null)");
    expect(source).toContain(".is('cte_emitted_at', null)");
    expect(source).toContain(".is('nfse_emitted_document_id', null)");
    expect(source).toContain(".from('fiscal_source_reservations')");
    expect(source).toContain('!reservedIds.has(document.id)');
  });
});
