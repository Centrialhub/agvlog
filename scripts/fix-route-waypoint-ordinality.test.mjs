import assert from 'node:assert/strict';
import { after, afterEach, before, beforeEach, describe, test } from 'node:test';
import { createRouteOrdinalityDatabase, ids, routePatch, routeSignatures } from './route-waypoint-ordinality-fixture.mjs';

let db;
const payload = (overrides = {}) => ({ tenant_id: ids.tenant, request_id: ids.request, name: '  Synthetic route  ',
  corridor_geofence_id: ids.geofence, corridor_inside_ratio_threshold: 0.85, allowed_outside_minutes: 5,
  route_speed_limit_kmh: 70, enabled: true, waypoints: [
    { waypoint_type: 'origin', label: 'Input first', poi_id: ids.poi },
    { waypoint_order: 9, waypoint_type: 'destination', label: 'Explicit nine', geofence_id: ids.geofence },
    { label: 'Input third', estimated_duration_min: 10, lat: -23.5, lng: -46.6 },
  ], ...overrides });

async function save(input = payload(), actor = ids.admin) {
  await db.query("SELECT set_config('request.jwt.claim.sub',$1,true)", [actor]);
  await db.exec('SET LOCAL ROLE authenticated');
  const result = await db.query('SELECT public.save_route_template_v1($1) AS result', [input]);
  await db.exec('RESET ROLE');
  return result.rows[0].result;
}
async function rejected(operation, pattern) {
  await db.exec('SAVEPOINT expected_rejection');
  await assert.rejects(operation, pattern);
  await db.exec('ROLLBACK TO expected_rejection; RELEASE expected_rejection');
}
async function state() {
  return Promise.all(['public.route_templates','public.route_waypoints','finance_private.atomic_command_results'].map(async (table) =>
    (await db.query(`SELECT to_jsonb(t) AS row FROM ${table} t ORDER BY to_jsonb(t)::text`)).rows));
}
const definitions = async () => (await db.query('SELECT pg_get_functiondef(oid) AS definition FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid', [routeSignatures])).rows;
const metadata = async () => (await db.query(`SELECT oid,proowner,proacl::text,proconfig,prosecdef,provolatile,prorettype
  FROM pg_proc WHERE oid=ANY($1::regprocedure[]) ORDER BY oid`, [routeSignatures])).rows;
const waypoints = async (route) => (await db.query('SELECT waypoint_order,waypoint_type,label,poi_id,geofence_id,estimated_duration_min,lat,lng FROM public.route_waypoints WHERE route_id=$1 ORDER BY waypoint_order', [route])).rows;

describe('captured route helper and durable public wrapper, isolated from application databases', () => {
  before(async () => { db = await createRouteOrdinalityDatabase(); });
  after(() => db?.close());
  beforeEach(() => db.exec('BEGIN'));
  afterEach(() => db.exec('ROLLBACK'));

  test('reproduces captured JSON error and real enum mismatch before creating route and ordered waypoints', async () => {
    const original = await state();
    const beforeMetadata = await metadata();
    const wrapperBefore = (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [routeSignatures[1]])).rows;
    await rejected(() => save(), /WITH ORDINALITY cannot be used with a column definition list/i);
    assert.deepEqual(await state(), original);
    await rejected(() => db.query("SELECT 'stop'::public.waypoint_type"), /invalid input value for enum waypoint_type/);
    await db.exec(routePatch);
    assert.deepEqual(await metadata(), beforeMetadata);
    assert.deepEqual((await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [routeSignatures[1]])).rows, wrapperBefore);
    const route = await save();
    assert.equal(route.name, 'Synthetic route');
    assert.equal(Number(route.revision), 1);
    assert.deepEqual(await waypoints(route.id), [
      { waypoint_order: 0, waypoint_type: 'origin', label: 'Input first', poi_id: ids.poi, geofence_id: null, estimated_duration_min: null, lat: null, lng: null },
      { waypoint_order: 2, waypoint_type: 'checkpoint', label: 'Input third', poi_id: null, geofence_id: null, estimated_duration_min: 10, lat: -23.5, lng: -46.6 },
      { waypoint_order: 9, waypoint_type: 'destination', label: 'Explicit nine', poi_id: null, geofence_id: ids.geofence, estimated_duration_min: null, lat: null, lng: null },
    ]);
    assert.equal((await db.query('SELECT count(*)::int AS count FROM finance_private.atomic_command_results')).rows[0].count, 1);
    const corrected = await definitions();
    await db.exec(routePatch);
    assert.deepEqual(await definitions(), corrected);
    assert.deepEqual(await metadata(), beforeMetadata);
  });

  test('the wrapper replays the same request exactly and rejects reusing its id for another payload', async () => {
    await db.exec(routePatch);
    const request = payload();
    const first = await save(request);
    const after = await state();
    assert.deepEqual(await save(request), first);
    assert.deepEqual(await state(), after);
    await rejected(() => save({ ...request, name: 'Different route' }), /request_payload_mismatch/);
    assert.deepEqual(await state(), after);
  });

  test('revision-checked replacement is atomic, preserves a foreign route and rejects stale edits', async () => {
    await db.exec(routePatch);
    const route = await save();
    const foreignBefore = await waypoints(ids.foreignRoute);
    const update = payload({ route_id: route.id, request_id: ids.updateRequest, expected_revision: 1,
      name: 'Revised route', waypoints: [{ label: 'Replacement' }] });
    const updated = await save(update);
    assert.equal(Number(updated.revision), 2);
    assert.equal((await waypoints(route.id)).length, 1);
    assert.equal((await waypoints(route.id))[0].label, 'Replacement');
    assert.deepEqual(await waypoints(ids.foreignRoute), foreignBefore);
    const after = await state();
    assert.deepEqual(await save(update), updated);
    assert.deepEqual(await state(), after);
    await rejected(() => save({ ...update, request_id: ids.staleRequest, name: 'Stale replacement' }), /route_template_changed/);
    await rejected(() => save({ ...update, request_id: ids.staleRequest, expected_revision: null }), /expected_route_revision_required/);
    assert.deepEqual(await state(), after);
  });

  test('authentication, admin, cross-tenant reference and route identity guards leave no partial writes', async () => {
    await db.exec(routePatch);
    const before = await state();
    await rejected(() => save(payload(), ''), /admin_required/);
    await rejected(() => save(payload(), ids.operator), /admin_required/);
    await rejected(() => save(payload({ tenant_id: ids.foreignTenant })), /admin_required/);
    await rejected(() => save(payload({ corridor_geofence_id: ids.foreignGeofence })), /corridor_geofence_not_found_in_tenant/);
    await rejected(() => save(payload({ waypoints: [{ poi_id: ids.foreignPoi }] })), /route_poi_not_found_in_tenant/);
    await rejected(() => save(payload({ waypoints: [{ geofence_id: ids.foreignGeofence }] })), /route_geofence_not_found_in_tenant/);
    await rejected(() => save(payload({ route_id: ids.foreignRoute, expected_revision: 1 })), /route_not_found/);
    await rejected(() => save(payload({ request_id: null })), /request_id_required/);
    await rejected(() => save(payload({ name: ' ' })), /route_name_required/);
    assert.deepEqual(await state(), before);
  });

  test('private helper remains unavailable directly and no route table grant is added for clients', async () => {
    await db.exec(routePatch);
    for (const role of ['anon','authenticated','service_role']) {
      assert.equal((await db.query('SELECT has_function_privilege($1,$2,\'EXECUTE\') AS allowed', [role,routeSignatures[0]])).rows[0].allowed, false);
    }
    assert.equal((await db.query("SELECT has_function_privilege('authenticated',$1,'EXECUTE') AS allowed", [routeSignatures[1]])).rows[0].allowed, true);
    await rejected(async () => {
      await db.exec('SET LOCAL ROLE authenticated');
      await db.query('SELECT finance_private.save_route_template_unsafe_20260917($1)', [payload()]);
    }, /permission denied for function/);
    assert.equal((await db.query("SELECT has_table_privilege('authenticated','public.route_templates','INSERT,UPDATE,DELETE') AS allowed")).rows[0].allowed, false);
  });

  test('unexpected helper body or table default refuses the patch without changing either function', async () => {
    const [{ definition }] = (await db.query('SELECT pg_get_functiondef($1::regprocedure) AS definition', [routeSignatures[0]])).rows;
    await db.exec(definition.replace("'stop'::public.waypoint_type", "'other'::public.waypoint_type"));
    const changed = await definitions();
    await rejected(() => db.exec(routePatch), /Route waypoint helper body changed/);
    assert.deepEqual(await definitions(), changed);
    await db.exec(definition);
    await db.exec("ALTER TABLE public.route_waypoints ALTER COLUMN waypoint_type SET DEFAULT 'other'::public.waypoint_type");
    const before = await definitions();
    await rejected(() => db.exec(routePatch), /Route waypoint enum\/default changed/);
    assert.deepEqual(await definitions(), before);
  });
});
