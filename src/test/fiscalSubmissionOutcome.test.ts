import { describe, expect, it } from 'vitest';
import { fiscalOperationResponse, isConfirmedSubmissionFailure } from '../../supabase/functions/_shared/fiscal-submission-outcome';

const blocked = { success: false, processing: false, terminal: true, requiresReconciliation: false,
  document: { id: 'hub', idIntegracao: 'ref', status: 'error' },
  error: { code: 'PROVIDER_SUBMISSION_BLOCKED', submissionOutcome: 'not_submitted', automaticRetry: false } };
describe('Hub submission contract', () => {
  it.each([
    ['error', 'recorded', 502, false, true, false],
    ['rejected', 'recorded', 422, false, true, false],
    ['processing', 'recorded', 202, true, false, false],
    ['provider_unknown', 'uncertain', 202, true, false, true],
    ['authorized', 'recorded', 200, true, true, false],
  ])('reports %s with its HTTP and pending semantics', (status, dispatch_state, http, success, terminal, requiresReconciliation) => {
    expect(fiscalOperationResponse({ id: 'local', hub_document_id: 'hub', status, dispatch_state, last_response: blocked }, blocked))
      .toMatchObject({ status: http, data: { success, terminal, requiresReconciliation } });
  });
  it('requires the explicit typed non-submission receipt', () => {
    expect(isConfirmedSubmissionFailure(blocked)).toBe(true);
    expect(isConfirmedSubmissionFailure({ ...blocked, terminal: 'true' })).toBe(false);
    expect(isConfirmedSubmissionFailure({ ...blocked, requiresReconciliation: true })).toBe(false);
    expect(isConfirmedSubmissionFailure({ ...blocked, error: { message: 'Serviço indisponível' } })).toBe(false);
    expect(isConfirmedSubmissionFailure({ ...blocked, error: { ...blocked.error, automaticRetry: true } })).toBe(false);
  });
  it('keeps a bare legacy error uncertain', () => {
    expect(fiscalOperationResponse({ id: 'local', status: 'error', dispatch_state: 'uncertain' }, {}))
      .toMatchObject({ status: 202, data: { terminal: false, requiresReconciliation: true } });
  });
  it('uses a newer committed authorization instead of an older failed HTTP receipt', () => {
    expect(fiscalOperationResponse({ id: 'local', status: 'authorized', dispatch_state: 'recorded' }, blocked))
      .toMatchObject({ status: 200, data: { success: true, terminal: true, requiresReconciliation: false,
        submissionOutcome: 'accepted', hub: { document: { submissionOutcome: 'accepted' } } } });
  });
});
