// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  createFiscalReadinessDatabase,
  prepareFiscal,
  serviceFiscal,
} from './helpers/fiscalReadinessDatabase';
import { operationIds as i } from './helpers/operationOutcomeDatabase';

let context: Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;

const validBody = (value = 100) => ({
  emitterCnpj: '11222333000181',
  environment: 'production',
  payload: {
    valor: value,
    destinatario: {
      endereco: {
        logradouro: 'RUA TESTE',
        numero: '51',
        bairro: 'CENTRO',
        municipio: 'PIRAPORA',
        uf: 'MG',
        cep: '39270000',
      },
    },
  },
});

async function claim(documentId: string, body = validBody()) {
  const response = await serviceFiscal<{ result: { dispatch: boolean; emission: { id: string } } }>(
    context.db,
    'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,$7,null,null) result',
    [i.tenant, i.operator, context.emitter, 'cte', 'production', JSON.stringify(body), documentId],
  );
  return response.rows[0].result;
}

beforeAll(async () => {
  context = await createFiscalReadinessDatabase();
  await context.db.exec(readFileSync(
    'supabase/migrations/20260915181527_classify_fiscal_preflight_failures.sql',
    'utf8',
  ));
  await context.db.exec(readFileSync(
    'supabase/migrations/20260916024241_recover_definitive_fiscal_preflight_retry.sql',
    'utf8',
  ));
}, 30000);
beforeEach(async () => { await context.db.exec('begin'); });
afterEach(async () => { await context.db.exec('rollback'); });
afterAll(async () => { await context.db.close(); });

it('records a non-retryable CT-e preflight failure as rejected and releases the emitter lane', async () => {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const second = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc2]);
  const reserved = await claim(first.id);
  const message = 'CTE_DESTINATARIO_ENDERECO_INCOMPLETO: logradouro é obrigatório';
  const result = await serviceFiscal<{ result: { confirmed: boolean; status: string } }>(
    context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,422) result',
    [i.tenant, reserved.emission.id, JSON.stringify({
      success: false,
      error: { code: 'CTE_PREFLIGHT_FAILED', category: 'validation', retryable: false, message },
    })],
  );

  expect(result.rows[0].result).toMatchObject({ confirmed: true, status: 'rejected' });
  expect((await context.db.query(
    'select status,dispatch_state,hub_document_id,message from hub_fiscal_emissions where id=$1',
    [reserved.emission.id],
  )).rows[0]).toEqual({
    status: 'rejected',
    dispatch_state: 'recorded',
    hub_document_id: null,
    message,
  });
  expect((await claim(second.id)).dispatch).toBe(true);
});

it('keeps an unknown document-less provider failure uncertain and blocks the lane', async () => {
  const first = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const second = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc2]);
  const reserved = await claim(first.id);
  const result = await serviceFiscal<{ result: { confirmed: boolean } }>(
    context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,503) result',
    [i.tenant, reserved.emission.id, JSON.stringify({
      success: false,
      error: { code: 'TRANSPORT_UNCERTAIN', category: 'transport', retryable: true },
    })],
  );
  expect(result.rows[0].result.confirmed).toBe(false);
  await expect(claim(second.id)).rejects.toThrow('fiscal_emitter_busy');
});

it('rejects an incomplete destination before inserting a durable dispatch intent', async () => {
  const prepared = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const incomplete = validBody();
  incomplete.payload.destinatario.endereco = {
    ...incomplete.payload.destinatario.endereco,
    logradouro: '',
    numero: '',
    bairro: '',
    cep: '',
  };
  await expect(claim(prepared.id, incomplete)).rejects.toThrow('cte_destination_address_incomplete');
  expect((await context.db.query<{ count: number }>(
    'select count(*)::int count from hub_fiscal_emissions',
  )).rows[0].count).toBe(0);
});

it('creates exactly one new CT-e dispatch after a definitive preflight payload is corrected', async () => {
  const prepared = await prepareFiscal(context.db, context.emitter, context.client, 'production', [i.doc]);
  const original = validBody(100);
  const first = await claim(prepared.id, original);
  await serviceFiscal(
    context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,422)',
    [i.tenant, first.emission.id, JSON.stringify({
      success: false,
      error: {
        code: 'CTE_PREFLIGHT_FAILED',
        category: 'validation',
        retryable: false,
        message: 'Destino incompleto',
      },
    })],
  );

  const unchangedReplay = await claim(prepared.id, original);
  expect(unchangedReplay).toMatchObject({ dispatch: false, emission: { id: first.emission.id } });

  const corrected = validBody(101);
  const retry = await claim(prepared.id, corrected);
  expect(retry.dispatch).toBe(true);
  expect(retry.emission.id).not.toBe(first.emission.id);

  const correctedReplay = await claim(prepared.id, corrected);
  expect(correctedReplay).toMatchObject({ dispatch: false, emission: { id: retry.emission.id } });
  expect((await context.db.query<{ count: number }>(
    'select count(*)::int count from hub_fiscal_emissions where fiscal_document_id=$1',
    [prepared.id],
  )).rows[0].count).toBe(2);
  expect((await context.db.query<{ retry_id: string }>(
    "select dispatch_reconciliation->>'correction_retry_emission_id' retry_id from hub_fiscal_emissions where id=$1",
    [first.emission.id],
  )).rows[0].retry_id).toBe(retry.emission.id);
});

it('applies the same correction/replay contract to document-less MDF-e preflight failures', async () => {
  const body = (value: number) => ({
    emitterCnpj: '11222333000181',
    externalId: 'mdfe-preflight-retry-qa',
    payload: { valor: value, ufCarregamento: 'MG', ufDescarregamento: 'SP' },
  });
  const claimMdfe = async (value: number) => (await serviceFiscal<{
    result: { dispatch: boolean; emission: { id: string } };
  }>(
    context.db,
    'select claim_hub_fiscal_emission($1,$2,$3,$4,$5,$6::jsonb,null,null,null) result',
    [i.tenant, i.operator, context.emitter, 'mdfe', 'production', JSON.stringify(body(value))],
  )).rows[0].result;

  const first = await claimMdfe(100);
  await serviceFiscal(
    context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,422)',
    [i.tenant, first.emission.id, JSON.stringify({
      success: false,
      error: {
        code: 'MDFE_PREFLIGHT_FAILED',
        category: 'validation',
        retryable: false,
        message: 'Percurso incompleto',
      },
    })],
  );

  expect((await claimMdfe(100)).dispatch).toBe(false);
  const retry = await claimMdfe(101);
  expect(retry.dispatch).toBe(true);
  expect(retry.emission.id).not.toBe(first.emission.id);
  expect(await claimMdfe(101)).toMatchObject({ dispatch: false, emission: { id: retry.emission.id } });
  expect((await context.db.query<{ count: number }>(
    "select count(*)::int count from hub_fiscal_emissions where doc_type='mdfe' and dispatch_key like 'mdfe:%mdfe-preflight-retry-qa'",
  )).rows[0].count).toBe(2);
});
