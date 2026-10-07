// @vitest-environment node
// WORKSPACE DRAFT: real SQL graph in isolated PGlite, not GoTrue/native approval.
import { PGlite } from '@electric-sql/pglite';
import { afterEach,beforeEach,describe,expect,it } from 'vitest';
import { applyDriverForward,createAuth,email,graphCounts,id,nextNonce,nonce,prepare,
  roleQuery,scope,setupDriverGraph } from './helpers/driverAccessDatabaseFixture';
let db: PGlite;
beforeEach(async () => { db=await setupDriverGraph(); },30_000);
afterEach(async () => { await db?.close(); });
const cancel = (login=email,reservation=nonce) => roleQuery(db,'service_role',
  'select public.cancel_auth_invite($1,$2)',[login,reservation]);
const ledger = () => db.query(`select email,encode(nonce_hash,'hex') hash,driver_id
  from private.auth_invite_authorizations order by email`);

describe('M5 SQL lifecycle on real invite-only predecessors and real pgcrypto', () => {
  it('pins the actual predecessor bodies and uses SHA256 rather than a digest stub', async () => {
    expect((await db.query(`select encode(extensions.digest(convert_to('abc','UTF8'),'sha256'),'hex') digest`)).rows)
      .toEqual([{digest:'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad'}]);
    expect((await db.query(`select proname,md5(prosrc) hash from pg_proc where oid in(
      'public.prepare_auth_invite_v2(text,uuid,uuid,text,public.app_role,uuid,text,jsonb)'::regprocedure,
      'private.enforce_invite_only_auth_user()'::regprocedure,
      'private.attach_invited_user_access_v1()'::regprocedure) order by proname`)).rows).toEqual([
      {proname:'attach_invited_user_access_v1',hash:'c84055daa6384d504e3db7ab7a7849b6'},
      {proname:'enforce_invite_only_auth_user',hash:'f7f4349038197d33f7edcc77fcf10749'},
      {proname:'prepare_auth_invite_v2',hash:'450c58dc7832ae4fc3146c7cfe8aa932'},
    ]);
    await applyDriverForward(db);
  });

  it('denies direct service Auth reads/updates while the private SECDEF helper and public invoker wrapper work', async () => {
    await applyDriverForward(db);
    expect((await db.query(`select has_table_privilege('service_role','auth.users','SELECT') read,
      has_table_privilege('service_role','auth.users','UPDATE') write`)).rows).toEqual([{read:false,write:false}]);
    await expect(roleQuery(db,'service_role','select email from auth.users')).rejects.toMatchObject({code:'42501'});
    await expect(roleQuery(db,'service_role',`update auth.users set deleted_at=now() where id=$1`,[id.legacy]))
      .rejects.toMatchObject({code:'42501'});
    expect((await scope(db)).rows[0].value).toMatchObject({managed:false,retired:false,deleted:false,active:true});
    const metadata=(await db.query(`select n.nspname,p.prosecdef,p.proconfig,r.rolname owner,
      has_function_privilege('anon',p.oid,'EXECUTE') anon,
      has_function_privilege('authenticated',p.oid,'EXECUTE') authenticated,
      has_function_privilege('service_role',p.oid,'EXECUTE') service
      from pg_proc p join pg_namespace n on n.oid=p.pronamespace join pg_roles r on r.oid=p.proowner
      where p.proname='driver_access_scope_v1' order by n.nspname`)).rows;
    expect(metadata).toEqual([
      {nspname:'private',prosecdef:true,proconfig:['search_path=""'],owner:'postgres',anon:false,authenticated:false,service:true},
      {nspname:'public',prosecdef:false,proconfig:['search_path=""'],owner:'postgres',anon:false,authenticated:false,service:true},
    ]);
    for (const role of ['anon','authenticated'] as const) {
      await expect(roleQuery(db,role,'select public.driver_access_scope_v1($1,$2,$3,false)',
        [id.tenant,id.admin,id.legacy])).rejects.toMatchObject({code:'42501'});
      await expect(roleQuery(db,role,'select private.driver_access_scope_v1($1,$2,$3,false)',
        [id.tenant,id.admin,id.legacy])).rejects.toMatchObject({code:'42501'});
    }
  });

  it('creates Auth+membership+driver link atomically, strips nonce and rejects replay', async () => {
    await applyDriverForward(db);
    await prepare(db);
    expect((await ledger()).rows[0]).toMatchObject({email,driver_id:id.freeDriver});
    await createAuth(db);
    expect(await graphCounts(db)).toEqual({auth:1,memberships:1,links:1});
    expect((await db.query(`select raw_user_meta_data from auth.users where id=$1`,[id.newUser])).rows)
      .toEqual([{raw_user_meta_data:{}}]);
    expect((await ledger()).rows).toEqual([]);
    expect((await scope(db,id.newUser)).rows[0].value)
      .toMatchObject({managed:true,retired:false,deleted:false,active:true,tenant_id:id.tenant});
    await expect(createAuth(db,id.replayUser)).rejects.toMatchObject({code:'28000'});
    expect(await graphCounts(db,id.replayUser)).toEqual({auth:0,memberships:0,links:0});
  });

  it.each(['inactive','demoted'])('rolls back the Auth AFTER graph when the reserving admin is %s', async mode => {
    await applyDriverForward(db);
    await prepare(db);
    await db.query(mode==='inactive'
      ? 'update tenant_memberships set active=false where tenant_id=$1 and user_id=$2'
      : "update tenant_memberships set role='operator' where tenant_id=$1 and user_id=$2",[id.tenant,id.admin]);
    await expect(createAuth(db)).rejects.toThrow('driver_access_forbidden');
    expect(await graphCounts(db)).toEqual({auth:0,memberships:0,links:0});
    expect((await ledger()).rows).toHaveLength(1);
    await cancel();
    expect((await ledger()).rows).toEqual([]);
  });

  it('denies non-admin, other-tenant and invalid driver creation before touching the nonce ledger', async () => {
    await applyDriverForward(db);
    for (const actor of [id.operator,id.legacy,id.otherAdmin]) {
      await expect(prepare(db,id.freeDriver,email,nonce,actor)).rejects.toThrow('driver_access_forbidden');
    }
    await expect(prepare(db,id.foreignDriver)).rejects.toThrow('driver_unavailable_or_already_linked');
    await expect(prepare(db,id.legacyDriver)).rejects.toThrow('driver_unavailable_or_already_linked');
    await expect(prepare(db,id.freeDriver,'qa..driver@usuario.com')).rejects.toThrow('invalid_driver_username');
    expect((await ledger()).rows).toEqual([]);
  });

  it('rejects wrong and expired nonces; cleanup never deletes another reservation', async () => {
    await applyDriverForward(db);
    await prepare(db);
    await expect(createAuth(db,id.newUser,email,nextNonce)).rejects.toMatchObject({code:'28000'});
    await cancel(email,nextNonce);
    expect((await ledger()).rows).toHaveLength(1);
    await db.exec(`update private.auth_invite_authorizations
      set created_at=now()-interval '20 minutes',expires_at=now()-interval '1 minute'`);
    await expect(createAuth(db)).rejects.toMatchObject({code:'28000'});
    expect(await graphCounts(db)).toEqual({auth:0,memberships:0,links:0});
    await cancel();
    expect((await ledger()).rows).toEqual([]);
  });

  it('sequentially reproduces competing usernames on one driver without an Auth/membership orphan', async () => {
    await applyDriverForward(db);
    await prepare(db);
    await prepare(db,id.freeDriver,'qa.second@usuario.com',nextNonce);
    await createAuth(db);
    await expect(createAuth(db,id.loser,'qa.second@usuario.com',nextNonce))
      .rejects.toThrow('driver_unavailable_or_already_linked');
    expect(await graphCounts(db)).toEqual({auth:1,memberships:1,links:1});
    expect(await graphCounts(db,id.loser)).toEqual({auth:0,memberships:0,links:0});
    expect((await ledger()).rows).toEqual([expect.objectContaining({email:'qa.second@usuario.com'})]);
    await cancel('qa.second@usuario.com',nextNonce);
    expect((await ledger()).rows).toEqual([]);
  });

  it('rolls back an invalid managed metadata graph and permits an intact valid retry', async () => {
    await applyDriverForward(db);
    await prepare(db);
    await expect(createAuth(db,id.newUser,email,nonce,{driver_username_managed:true,driver_access_tenant_id:id.otherTenant}))
      .rejects.toThrow();
    expect(await graphCounts(db)).toEqual({auth:0,memberships:0,links:0});
    expect((await ledger()).rows).toHaveLength(1);
    await createAuth(db);
    expect(await graphCounts(db)).toEqual({auth:1,memberships:1,links:1});
  });

  it('bounds the same username reservation by its current nonce and never adopts an existing Auth identity', async () => {
    await applyDriverForward(db);
    await prepare(db);
    await prepare(db,id.foreignDriver,email,nextNonce,id.otherAdmin,id.otherTenant);
    await cancel(email,nonce);
    expect((await ledger()).rows).toEqual([expect.objectContaining({email,driver_id:id.foreignDriver})]);
    await expect(createAuth(db)).rejects.toMatchObject({code:'28000'});
    await createAuth(db,id.newUser,email,nextNonce,
      {driver_username_managed:true,driver_access_tenant_id:id.otherTenant});
    await prepare(db);
    await expect(createAuth(db,id.loser)).rejects.toMatchObject({code:'23505'});
    expect(await graphCounts(db,id.loser)).toEqual({auth:0,memberships:0,links:0});
    expect((await db.query('select user_id from drivers where id=$1',[id.freeDriver])).rows).toEqual([{user_id:null}]);
    expect((await db.query('select user_id from drivers where id=$1',[id.foreignDriver])).rows)
      .toEqual([{user_id:id.newUser}]);
    await cancel();
  });

  it('preserves ordinary operator/client invitations through the same real Auth AFTER trigger', async () => {
    await applyDriverForward(db);
    await roleQuery(db,'service_role',`select public.prepare_auth_invite_v2($1,$2,$3,$4,'operator')`,
      ['qa.operator@example.test',id.tenant,id.admin,nonce]);
    await createAuth(db,id.newUser,'qa.operator@example.test',nonce,{});
    expect((await db.query('select role,active from tenant_memberships where user_id=$1',[id.newUser])).rows)
      .toEqual([{role:'operator',active:true}]);
    await roleQuery(db,'service_role',`select public.prepare_auth_invite_v2($1,$2,$3,$4,'client',$5,'full',$6::jsonb)`,
      ['qa.client@example.test',id.tenant,id.admin,nextNonce,id.client,{can_open_occurrences:true}]);
    await createAuth(db,id.replayUser,'qa.client@example.test',nextNonce,{});
    expect((await db.query(`select tenant_id,client_id,can_open_occurrences,can_request_pickup,created_by
      from client_portal_access where user_id=$1`,[id.replayUser])).rows).toEqual([
      {tenant_id:id.tenant,client_id:id.client,can_open_occurrences:true,can_request_pickup:false,created_by:id.admin},
    ]);
    expect((await ledger()).rows).toEqual([]);
  });

  it.each([[id.legacy,id.legacyDriver],[id.orphan,id.orphanDriver]])(
    'retires legacy %s, retries after an Auth failure and recreates on the same driver without rewriting history',
    async (oldUser,driver) => {
      await applyDriverForward(db);
      const history=(await db.query('select * from driver_history_fixture where driver_id=$1',[driver])).rows;
      await scope(db,oldUser,true);
      expect((await db.query('select user_id from drivers where id=$1',[driver])).rows).toEqual([{user_id:null}]);
      expect((await db.query('select active from tenant_memberships where user_id=$1',[oldUser])).rows)
        .not.toContainEqual({active:true});
      // No GoTrue call is made: leave deleted_at NULL to simulate failed Auth delete.
      // Orphan case requires trusted retired+tenant provenance after its last link was removed.
      expect((await scope(db,oldUser,true)).rows[0].value).toMatchObject({managed:false,deleted:false});
      await roleQuery(db,'supabase_auth_admin','update auth.users set deleted_at=now() where id=$1',[oldUser]);
      await expect(db.query('delete from auth.users where id=$1',[oldUser])).rejects.toMatchObject({code:'23503'});
      await prepare(db,driver);
      await createAuth(db);
      expect((await db.query('select user_id from drivers where id=$1',[driver])).rows).toEqual([{user_id:id.newUser}]);
      expect((await db.query('select * from driver_history_fixture where driver_id=$1',[driver])).rows).toEqual(history);
      expect((await db.query('select deleted_at is not null deleted from auth.users where id=$1',[oldUser])).rows)
        .toEqual([{deleted:true}]);
    });

  it('refuses shared/inactive other-role evidence and refuses treating a managed account as legacy', async () => {
    await applyDriverForward(db);
    const original=(await db.query('select raw_app_meta_data from auth.users where id=$1',[id.shared])).rows;
    await expect(scope(db,id.shared,true)).rejects.toThrow('shared_or_other_role');
    expect((await db.query('select raw_app_meta_data from auth.users where id=$1',[id.shared])).rows).toEqual(original);
    expect((await db.query('select user_id from drivers where id=$1',[id.sharedDriver])).rows)
      .toEqual([{user_id:id.shared}]);
    await prepare(db);await createAuth(db);
    await expect(scope(db,id.newUser,true)).rejects.toThrow('cannot_be_retired_as_legacy');
  });

  it('keeps the unique driver index and blocks promotion, sharing, portal, relinking and retired reactivation', async () => {
    const index=(await db.query(`select pg_get_indexdef('uq_drivers_tenant_user'::regclass) definition`)).rows;
    await applyDriverForward(db);
    expect((await db.query(`select pg_get_indexdef('uq_drivers_tenant_user'::regclass) definition`)).rows).toEqual(index);
    await prepare(db);await createAuth(db);
    const attempts = [
      ["update tenant_memberships set role='operator' where user_id=$1",[id.newUser]],
      ["insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[id.otherTenant,id.newUser]],
      ["insert into workspace_memberships(workspace_id,user_id,role,active) values($1,$2,'driver',true)",[id.otherWorkspace,id.newUser]],
      ["insert into user_roles(user_id,role) values($1,'admin')",[id.newUser]],
      ["insert into client_portal_access(tenant_id,user_id,client_id,access_type,active) values($1,$2,$3,'full',true)",
        [id.tenant,id.newUser,id.client]],
      ['update drivers set user_id=$1 where id=$2',[id.newUser,id.secondDriver]],
    ] as const;
    for (const [query,params] of attempts) await expect(roleQuery(db,'service_role',query,[...params])).rejects.toThrow();
    await scope(db,id.legacy,true);
    await expect(roleQuery(db,'service_role','update tenant_memberships set active=true where user_id=$1',[id.legacy]))
      .rejects.toThrow('driver_account_retired');
    await expect(roleQuery(db,'service_role','update drivers set user_id=$1 where id=$2',[id.legacy,id.secondDriver]))
      .rejects.toThrow('driver_account_retired');
    expect(await graphCounts(db)).toEqual({auth:1,memberships:1,links:1});
  });

  it.each([
    ['predecessor ACL',`grant execute on function private.enforce_invite_only_auth_user() to authenticated`,'predecessor_changed'],
    ['predecessor search_path',`alter function private.attach_invited_user_access_v1() set search_path=public`,'predecessor_changed'],
    ['predecessor owner',`create role fixture_owner;alter function private.attach_invited_user_access_v1() owner to fixture_owner`,'predecessor_changed'],
    ['predecessor grant option',`grant execute on function public.prepare_auth_invite_v2(text,uuid,uuid,text,public.app_role,uuid,text,jsonb) to service_role with grant option`,'predecessor_changed'],
    ['Auth trigger',`alter table auth.users disable trigger attach_invited_user_access_after_auth_user_created`,'invitation_trigger_changed'],
  ])('rejects %s drift before adding its schema or replacing bodies',async (_label,mutation,message) => {
    await db.exec(mutation);
    const before=(await db.query(`select p.oid,md5(p.prosrc) hash from pg_proc p
      where proname in('enforce_invite_only_auth_user','attach_invited_user_access_v1','prepare_auth_invite_v2') order by p.oid`)).rows;
    await expect(applyDriverForward(db)).rejects.toThrow(message);
    expect((await db.query(`select p.oid,md5(p.prosrc) hash from pg_proc p
      where proname in('enforce_invite_only_auth_user','attach_invited_user_access_v1','prepare_auth_invite_v2') order by p.oid`)).rows)
      .toEqual(before);
    expect((await db.query(`select exists(select 1 from information_schema.columns
      where table_schema='private' and table_name='auth_invite_authorizations' and column_name='driver_id') added`)).rows)
      .toEqual([{added:false}]);
  });
});
