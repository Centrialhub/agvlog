import { describe, expect, it } from 'vitest';
import { canSelectDocumentForNewLoad, getNewLoadCreationErrorMessage } from '@/lib/loads/newLoadDocumentSelection';

describe('new load document selection', () => {
  it('allows only documents that are not already linked to a load', () => {
    expect(canSelectDocumentForNewLoad({ load_id: null })).toBe(true);
    expect(canSelectDocumentForNewLoad({})).toBe(true);
    expect(canSelectDocumentForNewLoad({ load_id: 'load-123' })).toBe(false);
  });

  it('explains how to handle an already linked document', () => {
    expect(getNewLoadCreationErrorMessage(new Error('document_already_linked'))).toContain('mover ou replanejar');
  });

  it('keeps unknown backend messages intact', () => {
    expect(getNewLoadCreationErrorMessage(new Error('Falha inesperada'))).toBe('Falha inesperada');
  });
});
