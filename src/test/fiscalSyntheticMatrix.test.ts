// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createFiscalReadinessDatabase, prepareFiscal, serviceFiscal } from './helpers/fiscalReadinessDatabase';
import { operationIds as i } from './helpers/operationOutcomeDatabase';
import { fiscalServiceAdapter } from './helpers/fiscalServiceAdapter';
import { dispatchFiscalEmission } from '../../supabase/functions/_shared/fiscal-dispatch';
import { fiscalOperationResponse, isConfirmedSubmissionFailure } from '../../supabase/functions/_shared/fiscal-submission-outcome';

let context: Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
const facts = { processing: false, terminal: true, requiresReconciliation: false, submissionOutcome: 'not_submitted' };
const failure = { code: 'PROVIDER_SUBMISSION_BLOCKED', submissionOutcome: 'not_submitted', automaticRetry: false };
const body = { emitterCnpj: '11222333000181', environment: 'production', payload: {
  valor: 100, destinatario: { endereco: { logradouro: 'RUA QA', numero: '1', bairro: 'CENTRO', cep: '39270000' } },
} };
const blocked = (reference = 'ref') => ({ ...facts, success: true, error: failure,
  document: { id: 'hub-matrix', idIntegracao: reference, status: 'error' } });
beforeAll(async () => {
  context = await createFiscalReadinessDatabase();
  for (const name of ['20260915181527_classify_fiscal_preflight_failures.sql',
    '20260916024241_recover_definitive_fiscal_preflight_retry.sql',
    '20261021122925_classify_confirmed_submission_failures.sql',
    '20261021124814_align_fiscal_submission_outcome_channels.sql']) {
    await context.db.exec(readFileSync('supabase/migrations/' + name, 'utf8'));
  }
}, 30000);
beforeEach(async () => { await context.db.exec('begin'); });
afterEach(async () => { await context.db.exec('rollback'); });
afterAll(async () => { await context.db.close(); });

async function classification(receipt: unknown, expected: boolean) {
  const json = JSON.stringify(receipt);
  const actual = (await context.db.query<{ result: boolean }>(
    'select fiscal_submission_failure_is_definitive($1::jsonb) result', [json])).rows[0].result;
  expect(actual, json).toBe(expected);
  expect(isConfirmedSubmissionFailure(JSON.parse(json)), json).toBe(expected);
}
const values = [false, true, null, undefined, 'false', 0];
const combinations = ['root', 'document', 'both'].flatMap(location => values.flatMap(processing =>
  values.flatMap(terminal => values.map(requiresReconciliation => ({ location, processing, terminal, requiresReconciliation })))));
it.each(combinations)('typed facts $location/$processing/$terminal/$requiresReconciliation', async test => {
  const flags = { processing: test.processing, terminal: test.terminal, requiresReconciliation: test.requiresReconciliation };
  const receipt = blocked();
  const input = { success: true, error: failure,
    ...(test.location !== 'document' ? flags : {}),
    document: { ...receipt.document, ...(test.location !== 'root' ? flags : {}) },
  };
  await classification(input, test.processing === false && test.terminal === true && test.requiresReconciliation === false);
});

it.each([null, [], 'error', 1, {}, { document: [] }, { document: null }])('rejects malformed receipt %j', async receipt => {
  await classification(receipt, false);
});
it.each(['id', 'idIntegracao'])('rejects invalid identifier types for %s', async key => {
  for (const value of [null, '', 0, false, [], {}, undefined]) {
    await classification({ ...blocked(), document: { ...blocked().document, [key]: value } }, false);
  }
});
it.each(['processing', 'terminal', 'requiresReconciliation', 'submissionOutcome'])('rejects conflicting %s', async key => {
  await classification({ ...blocked(), document: { ...blocked().document, [key]: 'contradictory' } }, false);
});

async function operation() {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const claim = (await serviceFiscal<{ result: { emission: { id: string; id_integracao: string } } }>(context.db,
    'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,$7,null,null) result',
    [i.tenant, i.operator, context.emitter, 'cte', 'production', JSON.stringify(body), first.id])).rows[0].result;
  return { first, emission: claim.emission };
}
async function complete(id: string, response: unknown, http = 200, tenant = i.tenant) {
  return (await serviceFiscal<{ result: { confirmed: boolean; ignored?: boolean; reason?: string } }>(context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,$4) result',
    [tenant, id, JSON.stringify(response), http])).rows[0].result;
}
it.each([200, 202, 409, 422, 502, 503])('uses proof rather than HTTP %s to close a failure', async http => {
  const { emission } = await operation();
  expect(await complete(emission.id, blocked(emission.id_integracao), http)).toMatchObject({ confirmed: true });
  expect((await context.db.query('select status,dispatch_state from hub_fiscal_emissions')).rows[0])
    .toMatchObject({ status: 'error', dispatch_state: 'recorded' });
});
it.each(['reference', 'environment', 'emitter', 'accessKey', 'protocol'])('does not unlock contradictory %s', async variant => {
  const { emission } = await operation();
  const receipt = blocked(emission.id_integracao);
  const extra = variant === 'reference' ? { idIntegracao: 'wrong' } : variant === 'environment' ? { environment: 'homologation' }
    : variant === 'emitter' ? { emitterCnpj: '00000000000000' } : variant === 'accessKey' ? { accessKey: 'key' } : { authorizationProtocol: '123456789012345' };
  expect(await complete(emission.id, { ...receipt, document: { ...receipt.document, ...extra } }, 502))
    .toMatchObject({ confirmed: false });
});
it('rejects cross-tenant completion without changing the emission', async () => {
  const { emission } = await operation();
  await expect(complete(emission.id, blocked(emission.id_integracao), 200, '00000000-0000-4000-8000-000000000001'))
    .rejects.toThrow('fiscal_emission_not_found');
  expect((await context.db.query('select status from hub_fiscal_emissions')).rows[0]).toEqual({ status: 'pending' });
});
it('deduplicates and orders callbacks while preserving a later authorization', async () => {
  const { emission } = await operation();
  const receipt = { ...blocked(emission.id_integracao), documentVersion: 5, effectId: 'failure-effect' };
  expect(await complete(emission.id, receipt)).toMatchObject({ confirmed: true });
  expect(await complete(emission.id, receipt)).toMatchObject({ ignored: true, reason: 'out_of_order' });
  expect(await complete(emission.id, { documentVersion: 4, document: { id: 'hub-matrix', status: 'processing' } }))
    .toMatchObject({ ignored: true });
  await complete(emission.id, { documentVersion: 6, document: { id: 'hub-matrix', status: 'authorized', accessKey: 'key', authorizationProtocol: '123456789012345' } });
  expect(await complete(emission.id, { ...receipt, documentVersion: 7 })).toMatchObject({ ignored: true, reason: 'non_monotonic' });
  expect((await context.db.query('select status,provider_document_version from hub_fiscal_emissions')).rows[0])
    .toMatchObject({ status: 'authorized', provider_document_version: 6 });
});
it('does not repeat POST after transport failure without a Hub identity', async () => {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const call = vi.fn(async () => { throw new Error('Timeout'); });
  const input = { admin: fiscalServiceAdapter(context.db), tenant: i.tenant, actor: i.operator,
    emitter: context.emitter, type: 'cte', environment: 'production', body, fiscalId: first.id, call };
  for (let attempt = 0; attempt < 4; attempt++) expect(await dispatchFiscalEmission(input)).toMatchObject({ status: 409 });
  expect(call).toHaveBeenCalledTimes(1);
});
it.each(['error', 'provider_unknown', 'processing', 'authorized', 'rejected'])('serializes %s from committed state', status => {
  const result = fiscalOperationResponse({ id: 'local', status, dispatch_state: status === 'provider_unknown' ? 'uncertain' : 'recorded',
    last_response: blocked(), hub_document_id: 'hub-matrix' }, { document: { status: 'error', ...facts } });
  expect(result.data.hub.document.status).toBe(status);
  expect(result.data.hub.document.requiresReconciliation).toBe(result.data.requiresReconciliation);
  expect(result.data.hub.document.submissionOutcome).toBe(result.data.submissionOutcome);
  expect(result.data.terminal).toBe(!['provider_unknown', 'processing'].includes(status));
});
