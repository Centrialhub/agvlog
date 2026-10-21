// @vitest-environment node
// Executes real SQL/triggers on the synthetic PGlite graph; not GoTrue/MVCC proof.
import { readFileSync } from 'node:fs';
import { afterAll, afterEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(() => vi.stubGlobal('Deno', { env: { get: () => undefined } }));
import * as f from './helpers/driverCredentialCombinedFixture';
import { createAuth, email, id, nonce, prepare, roleQuery } from './helpers/driverAccessDatabaseFixture';
import { exportDriverSharedFixture } from './helpers/exportDriverSharedFixture';

const migration = readFileSync('supabase/migrations/20261019171216_driver_shared_workspace_account_creation.sql', 'utf8');
let exported = false;
afterEach(async () => { await f.db?.close(); });
afterAll(() => vi.unstubAllGlobals());
async function setup() {
  await f.setupCombinedDriverCredentials();
  await f.db.exec(f.source('20261013025826_driver_native_link_registry_protection.sql'));
  await f.db.query('update drivers set user_id=null where id in($1,$2)', [id.sharedDriver, id.foreignDriver]);
  await f.db.query(`insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'admin',true)
    on conflict(tenant_id,user_id) do update set role='admin',active=true`, [id.otherTenant, id.admin]);
  const production = JSON.parse(readFileSync('src/test/helpers/driverSharedAccountProductionBefore.json', 'utf8')) as Array<{ definition: string }>;
  for (const fn of production) await f.db.exec(fn.definition);
  if (process.env.DRIVER_NATIVE_FIXTURE_EXPORT && !exported) {
    await exportDriverSharedFixture(f.db, process.env.DRIVER_NATIVE_FIXTURE_EXPORT);
    exported = true;
  }
  await f.db.exec(migration);
}
const registry = async () => (await f.db.query("select id,to_jsonb(d)-'user_id' business from drivers d order by id")).rows;
const links = async () => (await f.db.query('select id,tenant_id from drivers where user_id=$1 order by tenant_id', [id.newUser])).rows;
async function create(fromOther = false) {
  const tenant = fromOther ? id.otherTenant : id.tenant;
  const driver = fromOther ? id.foreignDriver : id.sharedDriver;
  await prepare(f.db, driver, email, nonce, id.admin, tenant);
  await createAuth(f.db, id.newUser, email, nonce, { driver_username_managed: true, driver_access_tenant_id: tenant });
}

describe('one new identity across existing workspace driver records', () => {
  for (const fromOther of [false, true]) it(`creates from ${fromOther ? 'LIRA' : 'AGV'} without duplicating registries`, async () => {
    await setup(); const before = await registry();
    const history = (await f.db.query('select * from driver_history_fixture order by driver_id')).rows;
    await create(fromOther);
    expect(await links()).toHaveLength(2);
    expect((await f.db.query('select role,active from tenant_memberships where user_id=$1', [id.newUser])).rows)
      .toEqual([{ role: 'driver', active: true }, { role: 'driver', active: true }]);
    expect((await f.db.query('select role,active from workspace_memberships where user_id=$1', [id.newUser])).rows)
      .toEqual([{ role: 'driver', active: true }]);
    expect((await f.db.query<{meta: Record<string, unknown>}>('select raw_app_meta_data meta from auth.users where id=$1', [id.newUser])).rows[0].meta)
      .toMatchObject({ driver_workspace_managed: true, driver_access_workspace_id: id.workspace });
    expect(await registry()).toEqual(before);
    expect((await f.db.query('select * from driver_history_fixture order by driver_id')).rows).toEqual(history);
    expect((await f.db.query('select * from private.auth_invite_authorizations where email=$1', [email])).rows).toEqual([]);
  });
  it('does not attach another registry after the private creation capability has been consumed', async () => {
    await setup(); await create(); const before = await links();
    await expect(roleQuery(f.db, 'service_role', 'update drivers set user_id=$1 where id=$2', [id.newUser, id.freeDriver]))
      .rejects.toThrow('workspace_driver_link_change_forbidden');
    await expect(roleQuery(f.db, 'service_role', 'update drivers set user_id=null where id=$1', [id.sharedDriver]))
      .rejects.toThrow('workspace_driver_link_change_forbidden');
    expect(await links()).toEqual(before);
  });
  it('keeps GoTrue creation metadata compatible with the existing deferred credential guard', async () => {
    await setup(); const before = await registry();
    const metadata = { driver_username_managed: true, driver_access_tenant_id: id.tenant,
      driver_workspace_managed: true, driver_access_workspace_id: id.workspace };
    await prepare(f.db, id.sharedDriver);
    await createAuth(f.db, id.newUser, email, nonce, metadata);
    // Real GoTrue adds provider metadata by UPDATE after the INSERT triggers.
    await f.db.query('update auth.users set raw_app_meta_data=$1 where id=$2',
      [{ ...metadata, provider: 'email', providers: ['email'] }, id.newUser]);
    expect(await links()).toHaveLength(2); expect(await registry()).toEqual(before);
    await expect(f.db.query('update auth.users set raw_app_meta_data=$1 where id=$2',
      [{ driver_username_managed: true, driver_access_tenant_id: id.tenant }, id.newUser]))
      .rejects.toThrow('driver_credential_command_required');
  });
  it('can remove only the synthetic identity and free both preserved registries', async () => {
    await setup(); const before = await registry();
    const history = (await f.db.query('select * from driver_history_fixture order by driver_id')).rows;
    await create();
    // Deliberate backend-only cleanup of this history-free synthetic identity.
    // Suppress projection triggers only inside the cleanup transaction: ordinary
    // FK unlinking reprojects the canonical name into divergent existing rows.
    // Directly unlinking a live managed identity remains forbidden above.
    await f.db.exec('begin');
    await f.db.exec('set local session_replication_role=replica');
    await f.db.query('update drivers set user_id=null where user_id=$1', [id.newUser]);
    await f.db.query('delete from tenant_memberships where user_id=$1', [id.newUser]);
    await f.db.query('delete from workspace_memberships where user_id=$1', [id.newUser]);
    await f.db.query('delete from profiles where id=$1', [id.newUser]);
    await f.db.query('delete from auth.users where id=$1', [id.newUser]);
    await f.db.exec('set local session_replication_role=origin');
    await f.db.exec('commit');
    expect(await links()).toEqual([]);
    expect(await registry()).toEqual(before);
    expect((await f.db.query('select * from driver_history_fixture order by driver_id')).rows).toEqual(history);
    expect((await f.db.query('select id from auth.users where id=$1', [id.newUser])).rows).toEqual([]);
    // The same existing records can receive a subsequent real registration.
    await create(true);
    expect(await links()).toHaveLength(2);
  });
  it('revalidates the exact reserved graph before Auth insertion and rolls back on a changed sibling', async () => {
    await setup(); await prepare(f.db, id.sharedDriver);
    await f.db.query('update drivers set active=false where id=$1', [id.foreignDriver]);
    await expect(createAuth(f.db)).rejects.toThrow('driver_unavailable_or_already_linked');
    expect(await links()).toEqual([]);
    expect((await f.db.query('select id from auth.users where id=$1', [id.newUser])).rows).toEqual([]);
  });
  it('rejects a competing reservation after the first identity wins', async () => {
    await setup(); await prepare(f.db, id.sharedDriver);
    await prepare(f.db, id.foreignDriver, 'other.driver@usuario.com', nonce, id.admin, id.otherTenant);
    await createAuth(f.db);
    await expect(createAuth(f.db, id.replayUser, 'other.driver@usuario.com', nonce,
      { driver_username_managed: true, driver_access_tenant_id: id.otherTenant }))
      .rejects.toThrow('driver_unavailable_or_already_linked');
    expect(await links()).toHaveLength(2);
    expect((await f.db.query('select id from auth.users where id=$1', [id.replayUser])).rows).toEqual([]);
  });
  it('rejects public callers and forged invite metadata', async () => {
    await setup();
    for (const role of ['anon', 'authenticated'] as const) await expect(roleQuery(f.db, role,
      'select public.prepare_driver_access_v1($1,$2,$3,$4,$5)', [id.tenant, id.admin, id.sharedDriver, email, nonce]))
      .rejects.toThrow('permission denied');
    await expect(createAuth(f.db)).rejects.toThrow('authorized invitation');
    expect(await links()).toEqual([]);
  });
  it('applies idempotently without repairing any existing data', async () => {
    await setup(); const before = await f.accessGraph(), drivers = await registry();
    await f.db.exec(migration);
    expect(await f.accessGraph()).toEqual(before); expect(await registry()).toEqual(drivers);
  });
  it('requires an active administrator in every company receiving access', async () => {
    await setup();
    await expect(prepare(f.db, id.foreignDriver, email, nonce, id.otherAdmin, id.otherTenant))
      .rejects.toThrow('driver_access_forbidden');
    expect(await links()).toEqual([]);
  });
  it('rejects a canonical mapping moved into another workspace', async () => {
    await setup();
    await f.db.query('update tenants set workspace_id=$1 where id=$2', [id.otherWorkspace, id.otherTenant]);
    await expect(prepare(f.db, id.sharedDriver)).rejects.toThrow('driver_workspace_identity_mismatch');
    expect(await links()).toEqual([]);
  });
  it('rejects an inactive shared person without changing their registries', async () => {
    await setup(); const before = await registry();
    await f.db.query('update workspace_people set active=false where id=$1', [id.sharedDriver]);
    await expect(prepare(f.db, id.sharedDriver)).rejects.toThrow('driver_workspace_identity_missing');
    expect(await registry()).toEqual(before);
  });
  it('rejects a reservation with an injected unrelated registry', async () => {
    await setup(); await prepare(f.db, id.sharedDriver);
    await f.db.query(`update private.auth_invite_authorizations set permissions=jsonb_set(permissions,'{driver_ids}',
      (permissions->'driver_ids')||to_jsonb($1::text)) where email=$2`, [id.freeDriver, email]);
    await expect(createAuth(f.db)).rejects.toThrow('driver_creation_scope_changed');
    expect(await links()).toEqual([]);
  });
});
