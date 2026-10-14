// @vitest-environment node
// Partial synthetic SQL graph: executes real lifecycle functions, never GoTrue or shared services.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
vi.hoisted(()=>vi.stubGlobal('Deno',{env:{get:()=>undefined}}));
import * as f from './helpers/driverCredentialCombinedFixture';
import {createAuth,id,prepare,roleQuery,scope} from './helpers/driverAccessDatabaseFixture';
afterEach(async()=>{await f.db?.close();});
async function setup(){await f.setupCombinedDriverCredentials();await f.db.exec(readFileSync('supabase/migrations/20261013025826_driver_native_link_registry_protection.sql','utf8'));}
const currentNew=async()=>(await f.db.query(`select (select to_jsonb(u) from auth.users u where id=$1) auth,
(select jsonb_agg(to_jsonb(m) order by id) from tenant_memberships m where user_id=$1) memberships,
(select jsonb_agg(to_jsonb(w) order by id) from workspace_memberships w where user_id=$1) workspaces,
(select jsonb_agg(to_jsonb(d) order by id) from drivers d where user_id=$1) drivers`,[id.newUser])).rows;
describe('new driver access and legacy profile lifecycle contract',()=>{
 it('creating new access on another registry then retiring old identity preserves the entire new graph',async()=>{
  await setup();await f.managed();const before=await currentNew();const history=(await f.db.query('select * from driver_history_fixture')).rows;
  await scope(f.db,id.legacy,true);
  expect(await currentNew()).toEqual(before);expect((await f.db.query('select * from driver_history_fixture')).rows).toEqual(history);
  expect((await f.db.query('select user_id from drivers where id=$1',[id.legacyDriver])).rows).toEqual([{user_id:null}]);
  expect((await f.db.query('select active from tenant_memberships where user_id=$1',[id.legacy])).rows).not.toContainEqual({active:true});
  // Auth soft deletion may fail: replay still must not touch the new identity.
  await scope(f.db,id.legacy,true);expect(await currentNew()).toEqual(before);
 });
 it('same registry rejects creation before retirement and permits retire then recreate without deleting history',async()=>{
  await setup();const history=(await f.db.query('select * from driver_history_fixture where driver_id=$1',[id.legacyDriver])).rows;
  await expect(prepare(f.db,id.legacyDriver)).rejects.toThrow('driver_unavailable_or_already_linked');
  await scope(f.db,id.legacy,true);await prepare(f.db,id.legacyDriver);await createAuth(f.db);
  expect((await f.db.query('select user_id from drivers where id=$1',[id.legacyDriver])).rows).toEqual([{user_id:id.newUser}]);
  expect((await scope(f.db,id.newUser)).rows[0].value).toMatchObject({managed:true,active:true,tenant_id:id.tenant});
  expect((await f.db.query('select * from driver_history_fixture where driver_id=$1',[id.legacyDriver])).rows).toEqual(history);
 });
 it('never retires the new native or converted shared identity as a legacy account',async()=>{
  await setup();await f.managed();const before=await currentNew();await expect(scope(f.db,id.newUser,true)).rejects.toThrow('cannot_be_retired_as_legacy');expect(await currentNew()).toEqual(before);
  await roleQuery(f.db,'service_role','select public.prepare_driver_workspace_credentials_v1($1,$2,$3,$4,$5,$6,$7,$8)',[id.tenant,id.admin,id.shared,f.request,'convert',f.login,f.nonce,id.sharedDriver]);await f.authUpdate();const sharedBefore=await f.graph();
  await expect(scope(f.db,id.shared,true)).rejects.toThrow();expect(await f.graph()).toEqual(sharedBefore);
 });
 it('deleting a legacy registry is not retirement: its old Auth and membership remain while new account survives',async()=>{
  await setup();await f.managed();const before=await currentNew(),access=await f.accessGraph();
  await roleQuery(f.db,'service_role','delete from drivers where id=$1',[id.sharedDriver]);
  expect(await currentNew()).toEqual(before);expect(await f.accessGraph()).toEqual(access);
  expect((await scope(f.db,id.legacy)).rows[0].value).toMatchObject({retired:false,active:true});
  expect((await f.db.query('select active from tenant_memberships where user_id=$1 and tenant_id=$2',[id.shared,id.tenant])).rows).toEqual([{active:true}]);
 });
});
