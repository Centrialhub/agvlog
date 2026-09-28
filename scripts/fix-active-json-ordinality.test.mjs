import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createOrdinalityDatabase, dependencies, ids, movements, ordinalityPatch, signatures } from './json-ordinality-fixture.mjs';

let db;
async function rpc(sql, values, actor = ids.actor) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
  await db.exec('SET LOCAL ROLE authenticated');
  const result = await db.query(sql, values);
  await db.exec('RESET ROLE');
  return result.rows[0].result;
}
const pallet = (payload, actor) => rpc('SELECT public.edit_pallet_return_protocol_v1($1) AS result', [payload], actor);
const page = (movementOffset = 0, dependencyOffset = 0, limit = 2, scope = {}) => rpc(
  'SELECT public.get_finance_account_period_evidence_page($1,$2,$3,$4,$5,$6) AS result',
  [scope.tenant ?? ids.tenant, scope.account ?? ids.account, scope.closure ?? ids.closure, movementOffset, dependencyOffset, limit], scope.actor);

async function rejected(operation, pattern) {
  await db.exec('SAVEPOINT expected_rejection');
  await assert.rejects(operation, pattern);
  await db.exec('ROLLBACK TO SAVEPOINT expected_rejection; RELEASE SAVEPOINT expected_rejection');
}

async function metadata() {
  return (await db.query(`SELECT oid,oid::regprocedure::text AS signature,proowner,proacl::text,proconfig,prosecdef,
    provolatile,prorettype,obj_description(oid,'pg_proc') AS comment
    FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [signatures])).rows;
}
async function definitions() {
  return (await db.query('SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [signatures])).rows;
}
async function palletState() {
  return Promise.all(['pallet_return_protocols', 'pallet_return_items', 'pallet_return_history'].map(async (table) =>
    (await db.query(`SELECT * FROM public.${table} ORDER BY id`)).rows));
}

describe('real RPC JSON ordinality regressions in an isolated minimal PostgreSQL fixture', () => {
  before(async () => { db = await createOrdinalityDatabase(); });
  after(() => db?.close());
  beforeEach(() => db.exec('BEGIN'));
  afterEach(() => db.exec('ROLLBACK'));

  test('historical functions fail at their JSON expansion; patch enables execution without losing metadata or receipt hotfix', async () => {
    const beforeMetadata = await metadata();
    const beforePallet = await palletState();
    await rejected(() => pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol, items: [{ quantity: 2 }] }),
      /WITH ORDINALITY cannot be used with a column definition list/i);
    assert.deepEqual(await palletState(), beforePallet);
    await rejected(() => page(), /column "ordinal" does not exist/i);
    await db.exec(ordinalityPatch);
    assert.deepEqual(await metadata(), beforeMetadata);
    const changed = await pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol, items: [{ quantity: 2 }] });
    assert.equal(changed.total_quantity, 2);
    assert.deepEqual((await page()).movement_receipt_summary, { identified: 3, missing: 2 });
    const corrected = await definitions();
    await db.exec(ordinalityPatch);
    assert.deepEqual(await definitions(), corrected);
    assert.deepEqual(await metadata(), beforeMetadata);
  });

  test('movement pages preserve snapshot order, offsets, full totals and receipt counts across pages', async () => {
    await db.exec(ordinalityPatch);
    const first = await page(0, 0, 2);
    const second = await page(2, 2, 2);
    const last = await page(4, 4, 2);
    const empty = await page(7, 7, 2);
    assert.deepEqual(first.snapshot.facts.movements, movements.slice(0, 2));
    assert.deepEqual(second.snapshot.facts.movements, movements.slice(2, 4));
    assert.deepEqual(last.snapshot.facts.movements, movements.slice(4));
    assert.deepEqual(empty.snapshot.facts.movements, []);
    const sortedDependencies = [...dependencies].sort((a, b) => a.source_kind.localeCompare(b.source_kind) || a.source_id.localeCompare(b.source_id));
    assert.deepEqual(first.dependencies, sortedDependencies.slice(0, 2));
    assert.deepEqual(second.dependencies, sortedDependencies.slice(2, 4));
    assert.deepEqual(last.dependencies, []);
    for (const [offset, result] of [[0, first], [2, second], [4, last], [7, empty]]) {
      assert.deepEqual(result.movement_page, { offset, limit: 2, total: 5 });
      assert.deepEqual(result.dependency_page, { offset, limit: 2, total: 4 });
      assert.deepEqual(result.movement_receipt_summary, { identified: 3, missing: 2 });
      assert.equal(result.snapshot.facts.movement_total_cents, '1100');
      assert.deepEqual(result.snapshot.balances, { opening_cents: '2000', closing_cents: '3100' });
      assert.equal(Object.hasOwn(result.snapshot, 'dependencies'), false);
      assert.deepEqual(result.integrity, { dependencies_match: true, snapshot_matches_revision: true });
    }
    assert.equal((await page(0, 0, 0)).movement_page.limit, 1);
    assert.equal((await page(0, 0, 999)).movement_page.limit, 100);
    await rejected(() => page(-1), /finance_evidence_invalid_offset/);
    await rejected(() => page(0, -1), /finance_evidence_invalid_offset/);
  });

  test('replacing pallet items keeps explicit sort order and uses zero-based input order as fallback', async () => {
    await db.exec(ordinalityPatch);
    const result = await pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol, reason: 'Synthetic correction',
      patch: { supplier_name_snapshot: 'Revised supplier', notes: 'Revised' },
      items: [{ pallet_type_code: 'B', quantity: 2, notes: 'first' },
        { pallet_type_code: 'A', quantity: 3, sort_order: 10 }, { pallet_type_code: 'C', quantity: 4 }] });
    assert.equal(result.total_quantity, 9);
    assert.equal(result.supplier_name_snapshot, 'Revised supplier');
    assert.equal(result.updated_by, ids.actor);
    const items = (await db.query('SELECT pallet_type_code,quantity,sort_order FROM public.pallet_return_items WHERE protocol_id=$1 ORDER BY sort_order', [ids.protocol])).rows;
    assert.deepEqual(items, [{ pallet_type_code: 'B', quantity: 2, sort_order: 0 },
      { pallet_type_code: 'C', quantity: 4, sort_order: 2 }, { pallet_type_code: 'A', quantity: 3, sort_order: 10 }]);
    const foreign = (await db.query('SELECT pallet_type_code,quantity FROM public.pallet_return_items WHERE protocol_id=$1', [ids.foreignProtocol])).rows;
    assert.deepEqual(foreign, [{ pallet_type_code: 'FOREIGN', quantity: 7 }]);
    const history = (await db.query('SELECT action,reason,metadata,created_by FROM public.pallet_return_history')).rows;
    assert.deepEqual(history, [{ action: 'edited', reason: 'Synthetic correction', created_by: ids.actor,
      metadata: { patch: { supplier_name_snapshot: 'Revised supplier', notes: 'Revised' }, items_replaced: true } }]);
    await pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol, patch: { notes: 'Metadata only' } });
    assert.deepEqual((await db.query('SELECT pallet_type_code,quantity,sort_order FROM public.pallet_return_items WHERE protocol_id=$1 ORDER BY sort_order', [ids.protocol])).rows, items);
  });

  test('invalid pallet quantities reject atomically and tenant/authentication guards remain effective', async () => {
    await db.exec(ordinalityPatch);
    const before = await palletState();
    for (const items of [[{ quantity: 1.5 }], [{ quantity: 0 }], [{ quantity: -1 }],
      [{ quantity: 2147483647 }, { quantity: 1 }], [], {}]) {
      await rejected(() => pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol, items,
        patch: { supplier_name_snapshot: 'Must not persist' } }), /invalid_items/);
      assert.deepEqual(await palletState(), before);
    }
    await rejected(() => pallet({ tenant_id: ids.foreignTenant, protocol_id: ids.foreignProtocol }), /operator_required/);
    await rejected(() => pallet({ tenant_id: ids.tenant, protocol_id: ids.foreignProtocol }), /protocol_not_found/);
    await rejected(() => pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol }, ''), /authentication_required/);
    assert.deepEqual(await palletState(), before);
  });

  test('evidence reader refuses another tenant, mismatched closure/account and revoked membership', async () => {
    await db.exec(ordinalityPatch);
    await rejected(() => page(0, 0, 2, { tenant: ids.foreignTenant, account: ids.foreignAccount, closure: ids.foreignClosure }), /finance_access_denied/);
    await rejected(() => page(0, 0, 2, { closure: ids.foreignClosure }), /finance_period_closure_not_found/);
    await rejected(() => page(0, 0, 2, { account: ids.foreignAccount }), /finance_period_closure_not_found/);
    await db.query('UPDATE public.qa_memberships SET active=false WHERE user_id=$1', [ids.actor]);
    await rejected(() => page(), /finance_access_denied/);
  });

  test('unexpected second-function body rolls back the first replacement and preserves both original ACLs', async () => {
    const [{ definition }] = (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [signatures[1]])).rows;
    await db.exec(definition.replace('where ordinal > _movement_offset', 'where ordinal >= _movement_offset'));
    const before = await definitions();
    const beforeMetadata = await metadata();
    await rejected(() => db.exec(ordinalityPatch), /JSON ordinality body changed/);
    assert.deepEqual(await definitions(), before);
    assert.deepEqual(await metadata(), beforeMetadata);
    await rejected(() => pallet({ tenant_id: ids.tenant, protocol_id: ids.protocol, items: [{ quantity: 2 }] }),
      /WITH ORDINALITY cannot be used with a column definition list/i);
  });
});
