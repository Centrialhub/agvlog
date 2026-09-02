// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import {
  claimFiscal,
  createFiscalReadinessDatabase,
  prepareFiscal,
  serviceFiscal,
} from './helpers/fiscalReadinessDatabase';
import { operationIds as ids } from './helpers/operationOutcomeDatabase';

let context: Awaited<ReturnType<typeof createFiscalReadinessDatabase>>;

beforeAll(async () => { context = await createFiscalReadinessDatabase(); }, 30_000);
beforeEach(async () => { await context.db.exec('begin'); });
afterEach(async () => { await context.db.exec('rollback'); });
afterAll(async () => { await context.db.close(); });

async function callback(emissionId: string, version: number, status: string) {
  return serviceFiscal<{ result: { confirmed: boolean; status: string; ignored?: boolean; reason?: string } }>(
    context.db,
    'select complete_hub_fiscal_emission($1,$2,$3::jsonb,200) result',
    [ids.tenant, emissionId, JSON.stringify({
      event: 'fiscal_document.updated',
      documentVersion: version,
      occurredAt: `2026-09-01T15:0${version}:00Z`,
      effectId: `status:${status}`,
      document: { id: 'hub-qa', status },
    })],
  );
}

it('ignores an older callback version after authorization', async () => {
  const prepared = await prepareFiscal(context.db, context.emitter, context.client, 'production', [ids.doc]);
  const claim = await claimFiscal(context.db, context.emitter, prepared.id, 'production');

  expect((await callback(claim.emission.id, 2, 'authorized')).rows[0].result)
    .toMatchObject({ confirmed: true, status: 'authorized' });
  expect((await callback(claim.emission.id, 1, 'processing')).rows[0].result)
    .toMatchObject({ confirmed: true, status: 'authorized', ignored: true, reason: 'out_of_order' });

  const emission = (await context.db.query<{ status: string; version: number }>(
    'select status,provider_document_version::int version from hub_fiscal_emissions where id=$1',
    [claim.emission.id],
  )).rows[0];
  expect(emission).toEqual({ status: 'authorized', version: 2 });
});

it('communicates cancellation progress without releasing the billed source', async () => {
  const prepared = await prepareFiscal(context.db, context.emitter, context.client, 'production', [ids.doc]);
  const claim = await claimFiscal(context.db, context.emitter, prepared.id, 'production');

  await callback(claim.emission.id, 1, 'authorized');
  expect((await callback(claim.emission.id, 2, 'cancel_processing')).rows[0].result.status)
    .toBe('cancel_processing');
  expect((await callback(claim.emission.id, 3, 'cancel_rejected')).rows[0].result.status)
    .toBe('cancel_rejected');

  const document = (await context.db.query<{ status: string; sefaz_status: string; source_id: string | null }>(
    'select status,sefaz_status,cte_emitted_outbound_id source_id from fiscal_documents where id=$1',
    [prepared.id],
  )).rows[0];
  expect(document).toMatchObject({ status: 'authorized', sefaz_status: 'cancel_rejected' });
});
