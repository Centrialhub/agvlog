import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createOrdinalityDatabase, ids, movements, ordinalityPatch, signatures } from './json-ordinality-fixture.mjs';

const readMigration = (file) => readFileSync(new URL(`../supabase/migrations/${file}`, import.meta.url), 'utf8');
const palletPatch = readMigration('20260928184443_restore_whole_pallet_edit_guards.sql');
const receiptPatch = readMigration('20260928184444_restore_integral_movement_receipt_summary.sql');
let db;
const item = (quantity, extra = {}) => ({ pallet_type_code: 'TEST', pallet_type_name: 'Synthetic pallet', quantity, ...extra });
const payload = (items, extra = {}) => ({ tenant_id: ids.tenant, protocol_id: ids.protocol, items, ...extra });

async function rpc(sql, args, actor = ids.actor) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
  await db.exec('SET LOCAL ROLE authenticated');
  const result = await db.query(sql, args);
  await db.exec('RESET ROLE');
  return result.rows[0].result;
}
const pallet = (body, actor) => rpc('SELECT public.edit_pallet_return_protocol_v1($1) result', [body], actor);
const page = (offset = 0, dependencyOffset = 0, limit = 2, scope = {}) => rpc(
  'SELECT public.get_finance_account_period_evidence_page($1,$2,$3,$4,$5,$6) result',
  [scope.tenant ?? ids.tenant, scope.account ?? ids.account, scope.closure ?? ids.closure, offset, dependencyOffset, limit], scope.actor);
async function rejected(run, expected) {
  await db.exec('SAVEPOINT expected_failure');
  await assert.rejects(run, expected);
  await db.exec('ROLLBACK TO SAVEPOINT expected_failure; RELEASE SAVEPOINT expected_failure');
}
async function state() {
  const tables = ['pallet_return_protocols', 'pallet_return_items', 'pallet_return_history',
    'finance_account_period_closures', 'finance_account_period_dependencies'];
  const result = {};
  for (const table of tables) result[table] = (await db.query(`SELECT to_jsonb(t) row FROM public.${table} t ORDER BY to_jsonb(t)::text`)).rows;
  return result;
}
const metadata = async () => (await db.query(`SELECT oid,proowner,proacl::text,proconfig,prosecdef,provolatile,
  prorettype,proretset,prokind,proargnames,proargtypes::text,proargdefaults::text,proisstrict,proparallel,
  procost,prorows,obj_description(oid,'pg_proc') comment
  FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [signatures])).rows;
const definitions = async () => (await db.query('SELECT pg_get_functiondef(oid) definition FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [signatures])).rows;

// Exact captured RPC bodies, followed by the real ordinality forward. Supporting
// tables and membership helpers are minimal; full Supabase RLS and concurrent
// sessions still require the isolated staging contract and authenticated smoke.
describe('captured business contracts after the ordinality correction', () => {
  before(async () => {
    db = await createOrdinalityDatabase({ source: 'captured' });
    await db.exec(`ALTER TABLE public.pallet_return_items ALTER COLUMN quantity SET NOT NULL;
      ALTER TABLE public.pallet_return_items ADD CONSTRAINT pallet_return_item_qty_chk CHECK (quantity>0);
      ALTER TABLE public.pallet_return_protocols ALTER COLUMN total_quantity SET NOT NULL;
      BEGIN; ${ordinalityPatch} COMMIT;`);
  });
  after(() => db?.close());
  beforeEach(() => db.exec('BEGIN'));
  afterEach(() => db.exec('ROLLBACK'));

  test('reproduces fractional rounding before the guard and rejects the same request atomically afterward', async () => {
    const original = await state();
    await db.exec('SAVEPOINT reproduce_fraction');
    const accepted = await pallet(payload([item(1.5)]));
    assert.equal(accepted.total_quantity, 2);
    assert.deepEqual((await db.query('SELECT quantity FROM public.pallet_return_items WHERE protocol_id=$1', [ids.protocol])).rows, [{ quantity: 2 }]);
    await db.exec('ROLLBACK TO SAVEPOINT reproduce_fraction; RELEASE SAVEPOINT reproduce_fraction');
    await db.exec(palletPatch);
    await rejected(() => pallet(payload([item(1.5)], { patch: { notes: 'Must not persist' } })), /invalid_items/);
    assert.deepEqual(await state(), original);
  });

  test('reproduces inconsistent rounded item sums and prevents that persisted mismatch', async () => {
    await db.exec('SAVEPOINT reproduce_sum');
    const accepted = await pallet(payload([item(0.5), item(0.5)]));
    assert.equal(accepted.total_quantity, 1);
    assert.equal(Number((await db.query('SELECT sum(quantity) total FROM public.pallet_return_items WHERE protocol_id=$1', [ids.protocol])).rows[0].total), 2);
    await db.exec('ROLLBACK TO SAVEPOINT reproduce_sum; RELEASE SAVEPOINT reproduce_sum');
    const original = await state();
    await db.exec(palletPatch);
    await rejected(() => pallet(payload([item(0.5), item(0.5)])), /invalid_items/);
    assert.deepEqual(await state(), original);
  });

  for (const [label, items, previousCode] of [
    ['null quantity', [item(null)], '23502'],
    ['missing quantity', [{ pallet_type_code: 'TEST', pallet_type_name: 'Synthetic pallet' }], '23502'],
    ['individual overflow', [item(2147483648)], '22003'],
    ['total overflow', [item(2147483647), item(1)], '22003'],
    ['numeric total beyond bigint', [item('9223372036854775808')], '22003'],
  ]) {
    test(`${label}: replaces a storage error with invalid_items before any mutation`, async () => {
      const original = await state();
      await rejected(() => pallet(payload(items)), (error) => error.code === previousCode);
      assert.deepEqual(await state(), original);
      await db.exec(palletPatch);
      await rejected(() => pallet(payload(items, { patch: { notes: 'Must not persist' } })), /invalid_items/);
      assert.deepEqual(await state(), original);
    });
  }

  test('whole quantities, maximum integer, ordering, edits without items and repeated edits preserve their contract', async () => {
    await db.exec(palletPatch);
    assert.equal((await pallet(payload([item(2147483647)]))).total_quantity, 2147483647);
    const request = payload([item(2, { pallet_type_code: 'B' }), item(3, { pallet_type_code: 'A', sort_order: 9 })],
      { reason: 'Synthetic correction', patch: { supplier_name_snapshot: 'Changed', notes: 'New note' } });
    const result = await pallet(request);
    assert.equal(result.total_quantity, 5);
    assert.equal(result.supplier_name_snapshot, 'Changed');
    assert.equal(result.updated_by, ids.actor);
    const rows = (await db.query('SELECT pallet_type_code,quantity,sort_order FROM public.pallet_return_items WHERE protocol_id=$1 ORDER BY sort_order', [ids.protocol])).rows;
    assert.deepEqual(rows, [{ pallet_type_code: 'B', quantity: 2, sort_order: 0 }, { pallet_type_code: 'A', quantity: 3, sort_order: 9 }]);
    assert.equal((await pallet(request)).total_quantity, 5);
    assert.equal(Number((await db.query('SELECT count(*) n FROM public.pallet_return_history')).rows[0].n), 3);
    await pallet(payload(undefined, { patch: { notes: 'Metadata only' } }));
    assert.deepEqual((await db.query('SELECT pallet_type_code,quantity,sort_order FROM public.pallet_return_items WHERE protocol_id=$1 ORDER BY sort_order', [ids.protocol])).rows, rows);
    assert.deepEqual((await db.query('SELECT quantity FROM public.pallet_return_items WHERE protocol_id=$1', [ids.foreignProtocol])).rows, [{ quantity: 7 }]);
  });

  test('existing invalid-item, tenant, authentication and changed-status guards remain effective', async () => {
    await db.exec(palletPatch);
    const original = await state();
    for (const items of [[], {}, null, [item(0)], [item(-1)]]) await rejected(() => pallet(payload(items)), /invalid_items/);
    await rejected(() => pallet(payload([item(2)], { tenant_id: ids.foreignTenant, protocol_id: ids.foreignProtocol })), /operator_required/);
    await rejected(() => pallet(payload([item(2)], { protocol_id: ids.foreignProtocol })), /protocol_not_found/);
    await rejected(() => pallet(payload([item(2)]), ''), /authentication_required/);
    assert.deepEqual(await state(), original);
    await pallet(payload([item(2)]));
    await db.query("UPDATE public.pallet_return_protocols SET status='confirmed' WHERE id=$1", [ids.protocol]);
    const locked = await state();
    await rejected(() => pallet(payload([item(3)])), /protocol_locked/);
    assert.deepEqual(await state(), locked);
  });

  test('reproduces the absent receipt summary and restores integral counts on every bounded page', async () => {
    const original = await state();
    const beforePages = [];
    for (const offset of [0, 2, 4, 7]) beforePages.push(await page(offset, offset));
    assert.equal(Object.hasOwn(beforePages[0], 'movement_receipt_summary'), false);
    assert.equal(beforePages[0].snapshot.facts.movements.filter((movement) => movement.receipt_path?.trim()).length, 1);
    assert.equal(beforePages[0].movement_page.total, 5);
    await db.exec(receiptPatch);
    for (const [index, offset] of [0, 2, 4, 7].entries()) {
      const result = await page(offset, offset);
      const { movement_receipt_summary: summary, ...unchanged } = result;
      assert.deepEqual(summary, { identified: 3, missing: 2 });
      assert.deepEqual(unchanged, beforePages[index]);
      assert.deepEqual(result.snapshot.facts.movements, movements.slice(offset, offset + 2));
      assert.equal(summary.identified + summary.missing, result.movement_page.total);
      assert.equal(result.snapshot.facts.movement_total_cents, '1100');
      assert.deepEqual(result.integrity, { snapshot_matches_revision: true, dependencies_match: true });
    }
    assert.deepEqual((await page(0, 0, 1)).movement_receipt_summary, { identified: 3, missing: 2 });
    assert.deepEqual((await page(0, 0, 100)).movement_receipt_summary, { identified: 3, missing: 2 });
    assert.deepEqual(await state(), original);
  });

  test('receipt classification uses the frozen snapshot including missing, null and blank paths', async () => {
    await db.exec(receiptPatch);
    const snapshot = { facts: { movements: [{ id: 'missing' }, { receipt_path: null }, { receipt_path: '' },
      { receipt_path: '   ' }, { receipt_path: ' evidence/synthetic.pdf ' }] }, dependencies: [] };
    await db.query('UPDATE public.finance_account_period_closures SET snapshot=$2 WHERE id=$1', [ids.closure, snapshot]);
    assert.deepEqual((await page(4)).movement_receipt_summary, { identified: 1, missing: 4 });
    for (const empty of [{ facts: { movements: [] } }, { facts: { movements: null } }, { facts: { movements: {} } }, { facts: {} }, {}]) {
      await db.query('UPDATE public.finance_account_period_closures SET snapshot=$2 WHERE id=$1', [ids.closure, empty]);
      assert.deepEqual((await page(0)).movement_receipt_summary, { identified: 0, missing: 0 });
    }
  });

  test('evidence authorization, account binding, invalid offsets and integrity failures stay unchanged', async () => {
    await db.exec(receiptPatch);
    await rejected(() => page(0, 0, 2, { tenant: ids.foreignTenant, account: ids.foreignAccount, closure: ids.foreignClosure }), /finance_access_denied/);
    await rejected(() => page(0, 0, 2, { actor: '' }), /finance_access_denied/);
    await rejected(() => page(0, 0, 2, { account: ids.foreignAccount }), /finance_period_closure_not_found/);
    await rejected(() => page(0, 0, 2, { closure: ids.foreignClosure }), /finance_period_closure_not_found/);
    await rejected(() => page(-1), /finance_evidence_invalid_offset/);
    await rejected(() => page(0, -1), /finance_evidence_invalid_offset/);
    await db.query("UPDATE public.finance_account_period_closures SET snapshot_revision='tampered' WHERE id=$1", [ids.closure]);
    await db.query('DELETE FROM public.finance_account_period_dependencies WHERE tenant_id=$1 AND closure_id=$2', [ids.tenant, ids.closure]);
    assert.deepEqual((await page()).integrity, { snapshot_matches_revision: false, dependencies_match: false });
  });

  test('both forwards preserve function identity, ACL, defaults, settings and comments and repeat without changes', async () => {
    const beforeMetadata = await metadata();
    const beforeState = await state();
    await db.exec(palletPatch);
    await db.exec(receiptPatch);
    assert.deepEqual(await metadata(), beforeMetadata);
    assert.deepEqual(await state(), beforeState);
    const afterDefinitions = await definitions();
    await db.exec(palletPatch);
    await db.exec(receiptPatch);
    assert.deepEqual(await definitions(), afterDefinitions);
    assert.deepEqual(await metadata(), beforeMetadata);
  });

  for (const [name, index, patch] of [['pallet', 0, palletPatch], ['receipt', 1, receiptPatch]]) {
    test(`${name} preflight rejects an unknown body and metadata or execution-boundary drift`, async () => {
      const driftStatements = [
        readFileSync(new URL(`./fixtures/${index === 0 ? 'pallet-edit' : 'finance-period-evidence'}-captured-2026-09-28.sql`, import.meta.url), 'utf8'),
        `DO $drift$ BEGIN EXECUTE replace(pg_get_functiondef('${signatures[index]}'::regprocedure),'begin',E'begin\n -- unreviewed body'); END $drift$`,
        `ALTER FUNCTION ${signatures[index]} SET search_path=public`,
        `ALTER FUNCTION ${signatures[index]} ${index === 0 ? 'SECURITY DEFINER' : 'SECURITY INVOKER'}`,
        `ALTER FUNCTION ${signatures[index]} ${index === 0 ? 'STABLE' : 'VOLATILE'}`,
        `ALTER FUNCTION ${signatures[index]} OWNER TO service_role`,
        `GRANT EXECUTE ON FUNCTION ${signatures[index]} TO anon`,
        `GRANT EXECUTE ON FUNCTION ${signatures[index]} TO service_role`,
        `REVOKE EXECUTE ON FUNCTION ${signatures[index]} FROM authenticated`,
      ];
      for (const statement of driftStatements) {
        await db.exec('SAVEPOINT drift');
        await db.exec(statement);
        const beforeDefinitions = await definitions();
        await rejected(() => db.exec(patch), (error) => error.code === '55000');
        assert.deepEqual(await definitions(), beforeDefinitions);
        await db.exec('ROLLBACK TO SAVEPOINT drift; RELEASE SAVEPOINT drift');
      }
    });
  }
});
