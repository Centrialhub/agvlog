import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createOrdinalityDatabase, ids, movements, ordinalityPatch, signatures } from './json-ordinality-fixture.mjs';

let db;
async function rpc(sql, values) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [ids.actor]);
  await db.exec('SET LOCAL ROLE authenticated');
  const result = await db.query(sql, values);
  await db.exec('RESET ROLE');
  return result.rows[0].result;
}
const pallet = (items) => rpc('SELECT public.edit_pallet_return_protocol_v1($1) AS result',
  [{ tenant_id: ids.tenant, protocol_id: ids.protocol, items }]);
const page = (offset) => rpc('SELECT public.get_finance_account_period_evidence_page($1,$2,$3,$4,$4,2) AS result',
  [ids.tenant, ids.account, ids.closure, offset]);
async function rejected(operation, pattern) {
  await db.exec('SAVEPOINT expected_rejection');
  await assert.rejects(operation, pattern);
  await db.exec('ROLLBACK TO expected_rejection; RELEASE expected_rejection');
}
const metadata = async () => (await db.query(`SELECT oid,proowner,proacl::text,proconfig,prosecdef,provolatile,prorettype
  FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [signatures])).rows;
const definitions = async () => (await db.query('SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [signatures])).rows;

describe('captured baseline RPC bodies, independently of the newer historical definitions', () => {
  before(async () => { db = await createOrdinalityDatabase({ source: 'captured' }); });
  after(() => db?.close());
  beforeEach(() => db.exec('BEGIN'));
  afterEach(() => db.exec('ROLLBACK'));

  test('reproduces both captured failures then accepts the exact compact pallet form without changing metadata', async () => {
    const beforeMetadata = await metadata();
    const items = [{ pallet_type_code: 'T', pallet_type_name: 'Synthetic', quantity: 2 },
      { pallet_type_code: 'U', pallet_type_name: 'Synthetic other', quantity: 3, sort_order: 8 }];
    await rejected(() => pallet(items), /WITH ORDINALITY cannot be used with a column definition list/i);
    await rejected(() => page(0), /column "ordinal" does not exist/i);
    await db.exec(ordinalityPatch);
    assert.deepEqual(await metadata(), beforeMetadata);
    const result = await pallet(items);
    assert.equal(result.total_quantity, 5);
    assert.deepEqual((await db.query('SELECT pallet_type_code,quantity,sort_order FROM public.pallet_return_items WHERE protocol_id=$1 ORDER BY sort_order', [ids.protocol])).rows,
      [{ pallet_type_code: 'T', quantity: 2, sort_order: 0 }, { pallet_type_code: 'U', quantity: 3, sort_order: 8 }]);
    const middle = await page(2);
    assert.deepEqual(middle.snapshot.facts.movements, movements.slice(2, 4));
    assert.deepEqual(middle.movement_page, { offset: 2, limit: 2, total: 5 });
    assert.equal(middle.dependency_page.total, 4);
    const fixed = await definitions();
    await db.exec(ordinalityPatch);
    assert.deepEqual(await definitions(), fixed);
    assert.deepEqual(await metadata(), beforeMetadata);
  });

  test('ordinality alone preserves the captured gaps so separate reviewed forwards must restore them', async () => {
    await db.exec(ordinalityPatch);
    assert.equal(Object.hasOwn(await page(0), 'movement_receipt_summary'), false);
    // Captured SQL silently rounds numeric input into the integer columns. This
    // assertion documents the remaining defect; it is not the accepted contract.
    const result = await pallet([{ pallet_type_code: 'T', pallet_type_name: 'Synthetic', quantity: 1.5 }]);
    assert.equal(result.total_quantity, 2);
    assert.equal((await db.query('SELECT quantity FROM public.pallet_return_items WHERE protocol_id=$1', [ids.protocol])).rows[0].quantity, 2);
  });

  test('unreviewed compact whitespace variant fails closed rather than using a generic normalization', async () => {
    const [{ definition }] = (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [signatures[0]])).rows;
    await db.exec(definition.replace('quantity numeric,notes text,sort_order integer,ord bigint', 'quantity numeric, notes text,sort_order integer,ord bigint'));
    const before = await definitions();
    await rejected(() => db.exec(ordinalityPatch), /JSON ordinality body changed/);
    assert.deepEqual(await definitions(), before);
  });
});
