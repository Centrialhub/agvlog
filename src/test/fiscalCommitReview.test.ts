// @vitest-environment node
// Regressions found while reviewing af610a6 against the published Hub contract.
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createFiscalReadinessDatabase, prepareFiscal, serviceFiscal } from './helpers/fiscalReadinessDatabase';
import { operationIds as i } from './helpers/operationOutcomeDatabase';
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
import { HubFiscalOperationError } from '@/lib/fiscal/hubFiscalClient';
import { isDefinitiveCteIssueError } from '@/lib/fiscal/cteIssueOutcome';
import { isConfirmedSubmissionFailure } from '../../supabase/functions/_shared/fiscal-submission-outcome';

let context: Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
beforeAll(async () => {
  context = await createFiscalReadinessDatabase();
  for (const file of ['20260915181527_classify_fiscal_preflight_failures.sql',
    '20260916024241_recover_definitive_fiscal_preflight_retry.sql',
    '20261021122925_classify_confirmed_submission_failures.sql',
    '20261021124814_align_fiscal_submission_outcome_channels.sql']) {
    await context.db.exec(readFileSync('supabase/migrations/' + file, 'utf8'));
  }
}, 30000);
beforeEach(async () => { await context.db.exec('begin'); });
afterEach(async () => { await context.db.exec('rollback'); });
afterAll(async () => { await context.db.close(); });

it.each(['get', 'callback'])('reconciles non-submission from the Hub %s envelope', async channel => {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const request = { emitterCnpj: '11222333000181', environment: 'production', payload: {
    valor: 100, destinatario: { endereco: { logradouro: 'RUA QA', numero: '1', bairro: 'CENTRO', cep: '39270000' } },
  } };
  const claimed = (await serviceFiscal<{ result: { emission: { id: string; id_integracao: string } } }>(context.db,
    'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,$7,null,null) result',
    [i.tenant, i.operator, context.emitter, 'cte', 'production', JSON.stringify(request), first.id])).rows[0].result;
  // Hub withDocumentOutcome preserves GET success:true; buildDocumentPayload has no success field.
  const receipt = {
    ...(channel === 'get' ? { success: true } : { event: 'fiscal_document.updated' }),
    processing: false, terminal: true, requiresReconciliation: false, submissionOutcome: 'not_submitted',
    document: { id: 'hub-review', idIntegracao: claimed.emission.id_integracao, status: 'error',
      environment: 'production', emitterCnpj: request.emitterCnpj },
    error: { code: 'PROVIDER_SUBMISSION_BLOCKED', category: 'provider_configuration',
      message: 'Licença expirada.', submissionOutcome: 'not_submitted', automaticRetry: false },
  };
  const result = (await serviceFiscal<{ result: unknown }>(context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,200) result',
    [i.tenant, claimed.emission.id, JSON.stringify(receipt)])).rows[0].result;
  const state = (await context.db.query('select status,dispatch_state from hub_fiscal_emissions where id=$1',
    [claimed.emission.id])).rows[0];
  expect({ result, state }, JSON.stringify({ result, state })).toMatchObject({ result: { confirmed: true, status: 'error' },
    state: { status: 'error', dispatch_state: 'recorded' } });
});

it('preserves definitive rejection classification for the billing batch', () => {
  const error = new HubFiscalOperationError('Rejeição fiscal confirmada.', {
    success: false, processing: false, terminal: true, requiresReconciliation: false,
    error: { code: 'FISCAL_DOCUMENT_REJECTED', message: 'Rejeição fiscal confirmada.', automaticRetry: false },
  });
  expect(isDefinitiveCteIssueError(error)).toBe(true);
});

it.each(['root', 'document', 'conflict', 'string-boolean', 'generic-error', 'numeric-id', 'unknown'])(
  'keeps SQL and Edge classification aligned for %s facts', async variant => {
    const facts = { processing: false, terminal: true, requiresReconciliation: false, submissionOutcome: 'not_submitted' };
    const error = { code: 'PROVIDER_SUBMISSION_BLOCKED', submissionOutcome: 'not_submitted', automaticRetry: false };
    const document = { id: 'hub', idIntegracao: 'ref', status: 'error', ...facts, error };
    let response: unknown = { success: true, ...facts, document, error };
    if (variant === 'document') response = { success: true, document };
    if (variant === 'conflict') response = { ...facts, document: { ...document, requiresReconciliation: true }, error };
    if (variant === 'string-boolean') response = { ...facts, terminal: 'true', document, error };
    if (variant === 'generic-error') response = { document: { id: 'hub', idIntegracao: 'ref', status: 'error' }, error: { message: 'Indisponível' } };
    if (variant === 'numeric-id') response = { ...facts, document: { ...document, id: 123 }, error };
    if (variant === 'unknown') response = { ...facts, submissionOutcome: 'unknown', document, error };
    const expected = ['root', 'document'].includes(variant);
    const sql = (await context.db.query<{ result: boolean }>(
      'select public.fiscal_submission_failure_is_definitive($1::jsonb) result', [JSON.stringify(response)])).rows[0].result;
    expect(sql).toBe(expected);
    expect(isConfirmedSubmissionFailure(response)).toBe(expected);
  },
);

it('does not classify transport uncertainty as a definitive error for the batch', () => {
  expect(isDefinitiveCteIssueError(new HubFiscalOperationError('Timeout', {}))).toBe(false);
  expect(isDefinitiveCteIssueError(new HubFiscalOperationError('Contradictory', {
    processing: false, terminal: true, requiresReconciliation: true, submissionOutcome: 'not_submitted',
  }))).toBe(false);
});
