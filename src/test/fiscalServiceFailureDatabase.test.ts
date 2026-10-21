// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it, vi } from 'vitest';
import { createFiscalReadinessDatabase, prepareFiscal, serviceFiscal } from './helpers/fiscalReadinessDatabase';
import { operationIds as i } from './helpers/operationOutcomeDatabase';
import { fiscalServiceAdapter } from './helpers/fiscalServiceAdapter';
import { dispatchFiscalEmission } from '../../supabase/functions/_shared/fiscal-dispatch';

let context: Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;
const body = { emitterCnpj: '11222333000181', environment: 'production', payload: {
  valor: 100, destinatario: { endereco: { logradouro: 'RUA QA', numero: '1', bairro: 'CENTRO', cep: '39270000' } },
} };
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

async function claim(fiscalId: string) {
  return (await serviceFiscal<{ result: { dispatch: boolean; emission: { id: string; id_integracao: string } } }>(context.db,
    'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,$7,null,null) result',
    [i.tenant, i.operator, context.emitter, 'cte', 'production', JSON.stringify(body), fiscalId])).rows[0].result;
}
function blocked(reference: string) {
  return { success: false, processing: false, terminal: true, requiresReconciliation: false,
    document: { id: 'hub-blocked', idIntegracao: reference, status: 'error' },
    error: { code: 'PROVIDER_SUBMISSION_BLOCKED', category: 'provider_configuration',
      message: 'O provedor bloqueou a emissão por licença.', submissionOutcome: 'not_submitted', automaticRetry: false } };
}
async function complete(id: string, response: unknown, http = 502) {
  return (await serviceFiscal<{ result: { confirmed: boolean; status: string; ignored?: boolean } }>(context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,$4) result',
    [i.tenant, id, JSON.stringify(response), http])).rows[0].result;
}
async function operation() {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  return { first, reserved: await claim(first.id) };
}

it('ends a confirmed non-submission, clears issued flags, and releases the emitter for other notes', async () => {
  const { first, reserved } = await operation();
  expect(await complete(reserved.emission.id, blocked(reserved.emission.id_integracao)))
    .toMatchObject({ confirmed: true, status: 'error' });
  expect((await context.db.query('select status,dispatch_state,message from hub_fiscal_emissions')).rows[0])
    .toEqual({ status: 'error', dispatch_state: 'recorded', message: 'O provedor bloqueou a emissão por licença.' });
  expect((await context.db.query('select status,sefaz_status from fiscal_documents where id=$1', [first.id])).rows[0])
    .toEqual({ status: 'error', sefaz_status: 'error' });
  expect((await context.db.query('select cte_emitted_at,cte_emitted_outbound_id from fiscal_documents where id=$1', [i.doc])).rows[0])
    .toEqual({ cte_emitted_at: null, cte_emitted_outbound_id: null });
  const second = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc2]);
  expect((await claim(second.id)).dispatch).toBe(true);
});

it('allows a new user preparation with unchanged payload, but never re-dispatches the old claim', async () => {
  const { first, reserved } = await operation();
  await complete(reserved.emission.id, blocked(reserved.emission.id_integracao));
  expect(await complete(reserved.emission.id, { success: true, document: { id: 'hub-blocked', status: 'error' } }, 200))
    .toMatchObject({ status: 'error', ignored: true });
  expect(await claim(first.id)).toMatchObject({ dispatch: false, emission: { id: reserved.emission.id } });
  const retry = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  expect(retry.id).not.toBe(first.id);
  expect((await claim(retry.id)).dispatch).toBe(true);
  expect((await claim(retry.id)).dispatch).toBe(false);
});

it.each(['unknown', 'bare-error', 'missing-attestation', 'wrong-reference', 'contradictory-authorization'])(
  'preserves the lane on %s', async (variant) => {
    const { reserved } = await operation();
    const original = blocked(reserved.emission.id_integracao);
    const response: Record<string, unknown> = { ...original };
    if (variant === 'unknown') response.document = { ...original.document, status: 'provider_unknown' };
    if (variant === 'bare-error') { delete response.terminal; delete response.error; }
    if (variant === 'missing-attestation') response.error = { ...original.error, submissionOutcome: undefined };
    if (variant === 'wrong-reference') response.document = { ...original.document, idIntegracao: 'another-operation' };
    if (variant === 'contradictory-authorization') response.document = { ...original.document, accessKey: '123' };
    expect((await complete(reserved.emission.id, response)).confirmed).toBe(false);
    const second = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc2]);
    await expect(claim(second.id)).rejects.toThrow('fiscal_emitter_busy');
  },
);

it('accepts the canonical rejected/422 response without legacy exception fields', async () => {
  const { reserved } = await operation();
  expect(await complete(reserved.emission.id, { success: false, document: {
    id: 'hub-blocked', idIntegracao: reserved.emission.id_integracao, status: 'rejected', message: 'Rejeição fiscal',
  } }, 422)).toMatchObject({ confirmed: true, status: 'rejected' });
});

it.each(['processing', 'provider_unknown'])('retains %s/202 even when the Hub includes error details', async status => {
  const { reserved } = await operation();
  expect(await complete(reserved.emission.id, { success: true, processing: true, terminal: false,
    requiresReconciliation: status === 'provider_unknown', document: {
      id: 'hub-blocked', idIntegracao: reserved.emission.id_integracao, status,
    }, error: { code: 'PROVIDER_QUERY_UNCONFIRMED' } }, 202)).toMatchObject({ confirmed: true, status });
  const second = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc2]);
  await expect(claim(second.id)).rejects.toThrow('fiscal_emitter_busy');
});

it('does not downgrade authorization or reopen a terminal non-submitted result on delayed processing', async () => {
  const { reserved } = await operation();
  await complete(reserved.emission.id, blocked(reserved.emission.id_integracao));
  expect(await complete(reserved.emission.id, { document: { id: 'hub-blocked', status: 'processing' } }, 200))
    .toMatchObject({ status: 'error', ignored: true });
  await complete(reserved.emission.id, { document: { id: 'hub-blocked', status: 'authorized', accessKey: 'key' } }, 200);
  expect(await complete(reserved.emission.id, blocked(reserved.emission.id_integracao)))
    .toMatchObject({ status: 'authorized', ignored: true });
});

it('runs the Edge dispatch through SQL and returns 502 without automatic POST retry', async () => {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const call = vi.fn(async (_method: string, _path: string, _query?: unknown, request?: unknown) => {
    const reference = (request as Record<string, string>)?.idIntegracao;
    const row = (await context.db.query<{ id_integracao: string }>('select id_integracao from hub_fiscal_emissions')).rows[0];
    return { status: _method === 'GET' ? 200 : 502,
      data: { ...blocked(reference || row.id_integracao), success: _method === 'GET' } };
  });
  const input = { admin: fiscalServiceAdapter(context.db), tenant: i.tenant, actor: i.operator,
    emitter: context.emitter, type: 'cte', environment: 'production', body, fiscalId: first.id, call };
  const response = await dispatchFiscalEmission(input);
  expect(response).toMatchObject({ status: 502, data: { success: false, terminal: true,
    requiresReconciliation: false, error: { submissionOutcome: 'not_submitted', automaticRetry: false } } });
  await dispatchFiscalEmission(input);
  expect(call.mock.calls.map(args => args[0])).toEqual(['POST', 'GET']);
});

it('keeps the classifier inaccessible to browser roles', async () => {
  expect((await context.db.query<{ allowed: boolean }>(
    "select has_function_privilege('authenticated','public.fiscal_submission_failure_is_definitive(jsonb)','EXECUTE') allowed",
  )).rows[0].allowed).toBe(false);
});

it('retains the receipt across mirror failure and recovers with GET only', async () => {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const call = vi.fn(async (_method: string, _path: string, _query?: unknown, request?: unknown) => {
    const reference = (request as Record<string, string>)?.idIntegracao;
    const row = (await context.db.query<{ id_integracao: string }>('select id_integracao from hub_fiscal_emissions')).rows[0];
    return { status: _method === 'GET' ? 200 : 502,
      data: { ...blocked(reference || row.id_integracao), success: _method === 'GET' } };
  });
  const input = { admin: fiscalServiceAdapter(context.db, { failConfirmation: true }), tenant: i.tenant,
    actor: i.operator, emitter: context.emitter, type: 'cte', environment: 'production', body, fiscalId: first.id, call };
  expect(await dispatchFiscalEmission(input)).toMatchObject({ status: 409 });
  expect((await context.db.query('select hub_document_id from hub_fiscal_emissions')).rows[0])
    .toEqual({ hub_document_id: 'hub-blocked' });
  expect(await dispatchFiscalEmission(input)).toMatchObject({ status: 502, data: { terminal: true, requiresReconciliation: false } });
  expect(call.mock.calls.map(args => args[0])).toEqual(['POST', 'GET']);
});
