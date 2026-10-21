import { describe, expect, it } from 'vitest';
import { resolveNoteStatus, type ImportedNoteRow } from '@/hooks/useImportedNotesSummary';
import { isAuthorizedImportedCte, isAuthorizedImportedNfse } from '@/lib/importedNoteFiscalStatus';

describe('Processado requires a linked authorized fiscal document', () => {
  it.each(['planned', 'assembling', 'ready', 'loading', 'loaded', null])('does not infer authorization from a %s load or a legacy label', status => {
    const row = { load_id: 'load', loads: { status }, imported_note_status: 'processed' } as Partial<ImportedNoteRow>;
    expect(resolveNoteStatus(row)).toBe('not_processed');
  });
  it.each(['draft', 'error', 'rejected', 'processing', 'provider_unknown', 'cancelled', null])('rejects %s documents even when they have IDs', status => {
    expect(resolveNoteStatus({ cte_id: 'cte', cte_status: status, nfse_id: 'nfse', nfse_status: status })).toBe('not_processed');
  });
  it('requires a document link as well as authorization', () => {
    expect(resolveNoteStatus({ cte_status: 'authorized', nfse_status: 'issued' })).toBe('not_processed');
    expect(resolveNoteStatus({ cte_id: 'cte' })).toBe('not_processed');
  });
  it.each(['issued', 'authorized'])('recognizes an %s NFS-e without a CT-e or load', nfse_status => {
    expect(resolveNoteStatus({ nfse_id: 'nfse', nfse_status })).toBe('processed');
  });
  it('recognizes an authorized CT-e and retains later transport states', () => {
    expect(resolveNoteStatus({ cte_id: 'cte', cte_status: 'authorized' })).toBe('processed');
    expect(resolveNoteStatus({ cte_id: 'cte', cte_status: 'authorized', status: 'delivered' })).toBe('delivered');
    expect(resolveNoteStatus({ nfse_id: 'nfse', nfse_status: 'issued', delivery_meta: { ne: true } })).toBe('not_delivered');
  });
  it('rejects cancelled or contradictory CT-e evidence', () => {
    expect(isAuthorizedImportedCte({ status: 'authorized', cancelled_at: '2026-10-21' })).toBe(false);
    expect(isAuthorizedImportedCte({ status: 'authorized', sefaz_status: 'rejected' })).toBe(false);
    expect(isAuthorizedImportedCte({ status: 'error', sefaz_status: 'authorized' })).toBe(false);
    expect(isAuthorizedImportedCte({ status: 'AUTHORIZED', sefaz_status: 'authorized' })).toBe(true);
    expect(isAuthorizedImportedNfse({ status: ' ISSUED ' })).toBe(true);
  });
});
