import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createPollDatabase, ids, payload, pollRepair, signature } from './legacy-fiscal-poll-fixture.mjs';

let db;
async function invoke(value, role = 'service_role', claim = role) {
  await db.query("SELECT set_config('request.jwt.claim.role',$1,true)", [claim]);
  await db.exec(`SET LOCAL ROLE ${role}`);
  const result = (await db.query(`SELECT ${signature.replace('(jsonb)', '($1::jsonb)')} AS result`, [value])).rows[0].result;
  await db.exec('RESET ROLE');
  return result;
}
async function rejected(operation, pattern) {
  await db.exec('SAVEPOINT expected_rejection');
  await assert.rejects(operation, pattern);
  await db.exec('ROLLBACK TO SAVEPOINT expected_rejection; RELEASE SAVEPOINT expected_rejection');
}
const state = async () => Promise.all(['hub_fiscal_emissions', 'fiscal_documents', 'nfse_documents',
  'entity_audit_log', 'nfse_events', 'vehicle_events'].map(async (name) =>
  (await db.query(`SELECT * FROM public.${name} ORDER BY id`)).rows));
const definition = async () => (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [signature])).rows[0].definition;
const metadata = async () => (await db.query(`SELECT oid,proowner,proacl::text,proconfig,prosecdef,provolatile,
  obj_description(oid,'pg_proc') AS comment FROM pg_proc WHERE oid=$1::regprocedure`, [signature])).rows;

describe('legacy CT-e polling event repair using real SQL in isolated PostgreSQL', () => {
  before(async () => { db = await createPollDatabase(); });
  after(() => db?.close());
  beforeEach(() => db.exec('BEGIN'));
  afterEach(() => db.exec('ROLLBACK'));

  test('reproduces undefined vehicle columns and rolls back both fiscal updates before repair', async () => {
    const previous = await state();
    await rejected(() => invoke(payload()), /column "document_id" of relation "vehicle_events" does not exist/);
    assert.deepEqual(await state(), previous);
  });

  for (const outcome of ['authorized', 'rejected', 'cancelled']) {
    test(`commits CT-e ${outcome} with tenant-scoped audit and source release atomically`, async () => {
      await db.exec(pollRepair);
      const request = payload('cte', outcome);
      assert.deepEqual(await invoke(request), { committed: true, document_id: ids.document });
      assert.deepEqual((await db.query('SELECT status,sefaz_status,sefaz_message,status_check_attempts FROM fiscal_documents WHERE id=$1', [ids.document])).rows,
        [{ status: outcome, sefaz_status: outcome, sefaz_message: `Provider ${outcome}`, status_check_attempts: 3 }]);
      assert.equal((await db.query('SELECT status FROM hub_fiscal_emissions WHERE id=$1', [ids.emission])).rows[0].status, outcome);
      assert.deepEqual((await db.query(`SELECT tenant_id,entity_type,entity_id,action,new_data,source FROM entity_audit_log`)).rows,
        [{ tenant_id: ids.tenant, entity_type: 'fiscal_document', entity_id: ids.document, action: outcome,
          new_data: { document_kind: 'cte', emission_id: ids.emission, message: request.event.message, payload: request.event.payload }, source: 'cte-status-poll' }]);
      const sources = (await db.query('SELECT id,cte_emitted_outbound_id FROM fiscal_documents WHERE id=ANY($1::uuid[]) ORDER BY id', [[ids.source, ids.otherSource]])).rows;
      assert.deepEqual(sources, [
        { id: ids.source, cte_emitted_outbound_id: request.release_sources ? null : ids.document },
        { id: ids.otherSource, cte_emitted_outbound_id: ids.document },
      ]);
      assert.equal((await db.query('SELECT count(*)::int AS count FROM vehicle_events')).rows[0].count, 0);
      assert.equal((await db.query('SELECT status FROM fiscal_documents WHERE id=$1', [ids.otherDocument])).rows[0].status, 'processing');
    });
  }

  for (const kind of ['cte', 'nfse']) {
    for (const explicitNull of [false, true]) {
      test(`${kind} pending poll accepts ${explicitNull ? 'JSON null' : 'omitted'} event without an audit/event row`, async () => {
        await db.exec(pollRepair);
        const request = payload(kind, 'processing');
        if (explicitNull) request.event = null; else delete request.event;
        assert.equal((await invoke(request)).committed, true);
        for (const table of ['entity_audit_log', 'nfse_events', 'vehicle_events']) {
          assert.equal((await db.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count, 0);
        }
      });
    }
  }

  test('preserves the NFS-e event writer and payload, without creating CT-e audit rows', async () => {
    await db.exec(pollRepair);
    const request = payload('nfse', 'authorized');
    request.document_patch.nfse_number = '123';
    request.document_patch.verification_code = 'synthetic-code';
    await invoke(request);
    assert.deepEqual((await db.query('SELECT tenant_id,nfse_id,event_type,message,payload FROM nfse_events')).rows,
      [{ tenant_id: ids.tenant, nfse_id: ids.nfse, event_type: 'authorized', message: request.event.message, payload: request.event.payload }]);
    assert.deepEqual((await db.query('SELECT status,nfse_number,verification_code FROM nfse_documents WHERE id=$1', [ids.nfse])).rows,
      [{ status: 'authorized', nfse_number: '123', verification_code: 'synthetic-code' }]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM entity_audit_log')).rows[0].count, 0);
  });

  test('retains service-only ACL and tenant predicates; errors leave fiscal state unchanged', async () => {
    await db.exec(pollRepair);
    const previous = await state();
    for (const role of ['anon', 'authenticated']) await rejected(() => invoke(payload(), role, 'service_role'), /permission denied for function/);
    await rejected(() => invoke(payload(), 'service_role', 'authenticated'), /service_role_required/);
    await rejected(() => invoke({ ...payload(), tenant_id: ids.otherTenant }), /emission_not_found/);
    await rejected(() => invoke({ ...payload(), document_id: ids.otherDocument }), /document_not_found/);
    // Failure in the event writer must also roll back release_sources and both status updates.
    await rejected(() => invoke({ ...payload('cte', 'rejected'), event: { message: 'Missing event type' } }), /null value in column "action"/);
    assert.deepEqual(await state(), previous);
  });

  test('changes only the two guarded fragments and preserves metadata, unrelated hotfixes and repeatability', async () => {
    const current = await definition();
    await db.exec(current.replace('begin\n', 'begin\n  -- unrelated published hotfix marker\n'));
    const beforeDefinition = await definition();
    const beforeMetadata = await metadata();
    await db.exec(pollRepair);
    const repaired = await definition();
    assert.deepEqual(await metadata(), beforeMetadata);
    assert.ok(repaired.includes('-- unrelated published hotfix marker'));
    assert.equal(repaired.slice(repaired.indexOf("  elsif v_kind='nfse'")), beforeDefinition.slice(beforeDefinition.indexOf("  elsif v_kind='nfse'")));
    await db.exec(pollRepair);
    assert.equal(await definition(), repaired);
    assert.deepEqual(await metadata(), beforeMetadata);
  });

  test('refuses an unknown event-writer body before changing the function', async () => {
    await db.exec((await definition()).replace('insert into public.vehicle_events(', 'insert into public.vehicle_events ('));
    const previous = await definition();
    await rejected(() => db.exec(pollRepair), /Legacy fiscal poll body changed/);
    assert.equal(await definition(), previous);
  });
});
