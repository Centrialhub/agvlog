import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const panelSource = readFileSync('src/components/loads/NFSePanel.tsx', 'utf8');
const formSource = readFileSync('src/components/nfse/NFSeFormDialog.tsx', 'utf8');

describe('reported NFS-e load panel regressions', () => {
  it('surfaces load document query failures and offers an explicit retry', () => {
    expect(formSource).toContain('if (error) throw error');
    expect(formSource).toContain('loadDocumentsQuery.isError');
    expect(formSource).toContain('loadDocumentsQuery.refetch()');
  });

  it('does not present a failed NFS-e list as an empty load', () => {
    expect(panelSource).toContain('notesQuery.isLoading');
    expect(panelSource).toContain('notesQuery.isError');
    expect(panelSource).toContain('notesQuery.refetch()');
    expect(panelSource.indexOf('notesQuery.isError')).toBeLessThan(panelSource.indexOf('notes.length === 0'));
  });

  it('keeps the new document defaults stable while the dialog is open', () => {
    expect(panelSource).toContain('const initialDocument = useMemo');
    expect(panelSource).toContain('initial={initialDocument}');
  });

  it('only allows a draft to be emitted from the load panel', () => {
    expect(panelSource).toContain("n.status === 'draft' &&");
    expect(panelSource).not.toContain("n.status === 'draft' || n.status === 'rejected'");
  });
});
