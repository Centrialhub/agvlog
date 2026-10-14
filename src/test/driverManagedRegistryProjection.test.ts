// @vitest-environment node
// Current SQL bodies and candidate migration, synthetic rows, isolated PGlite.
// This partial graph is not a substitute for Native/RLS release validation.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDriverForward, createAuth, prepare, id, roleQuery, scope, setupDriverGraph } from './helpers/driverAccessDatabaseFixture';

let db: PGlite;
afterEach(async () => { await db?.close(); });
const source = (name: string) => readFileSync(`supabase/migrations/${name}`,'utf8').replace(/\r\n/g,'\n');
const native = JSON.parse(readFileSync('src/test/helpers/native-safe-trigger-functions.json','utf8')) as Array<{
  signature: string; definition: string; owner: string; bodyMd5: string;
}>;

async function setup(sameWorkspace: boolean, otherActive=true, otherRole='driver') {
  db = await setupDriverGraph();
  await db.exec(`
    create role supabase_admin;
    alter table tenant_memberships add column updated_at timestamptz not null default now();
    alter table workspace_memberships add column updated_at timestamptz not null default now();
    alter table drivers add column phone text;
    create table public.profiles(id uuid primary key references auth.users,full_name text);
    create table public.entity_audit_log(id uuid primary key default gen_random_uuid(),tenant_id uuid,
      entity_type text,entity_id uuid,action text,old_data jsonb,new_data jsonb,actor_user_id uuid,source text);
    grant insert on public.entity_audit_log to supabase_admin;
    grant usage on schema public,auth to supabase_admin;
  `);
  if(sameWorkspace) await db.query('update tenants set workspace_id=$1 where id=$2',[id.workspace,id.otherTenant]);
  // Seed the legacy graph before installing the actual scope/sync guards.
  await db.query("update tenant_memberships set role='driver',active=true where user_id=$1",[id.shared]);
  await db.query('update tenant_memberships set role=$1::public.app_role,active=$2 where user_id=$3 and tenant_id=$4',
    [otherRole,otherActive,id.shared,id.otherTenant]);
  await db.query('update drivers set user_id=$1 where id=$2',[id.shared,id.foreignDriver]);
  await db.query(`insert into workspace_memberships(workspace_id,user_id,role,active)
    select distinct workspace_id,$1::uuid,'driver'::public.app_role,true from tenants`,[id.shared]);
  await db.query("insert into profiles values($1,'Global synthetic name')",[id.shared]);
  for(const row of native) {
    if(!['postgres','supabase_admin'].includes(row.owner)) throw new Error('Unexpected fixture owner');
    await db.exec(`${row.definition.trimEnd()}; alter function ${row.signature} owner to ${row.owner};
      revoke all on function ${row.signature} from public,anon,authenticated,service_role;`);
  }
  await db.exec(`
    create trigger audit_tenant_membership_change_v1 after update on tenant_memberships
      for each row execute function public.audit_tenant_membership_change_v1();
    create trigger tenant_memberships_sync_workspace_employee after insert or delete or update of role,active
      on tenant_memberships for each row execute function private.sync_employee_from_tenant_membership_v1();
    create trigger trg_block_client_membership before insert or update of role on tenant_memberships
      for each row execute function public._block_client_membership();
    create trigger trg_protect_tenant_owners before insert or delete or update on tenant_memberships
      for each row execute function public.protect_tenant_owners();
    create trigger workspace_memberships_set_updated_at before update on workspace_memberships
      for each row execute function public.update_updated_at_column();
    create trigger workspace_memberships_sync_tenants after insert or delete or update of role,active
      on workspace_memberships for each row execute function private.sync_employee_from_workspace_membership_v1();
  `);
  const adminPredicate=source('20260831164442_remove_authenticator_requirement.sql')
    .match(/create or replace function public\.is_tenant_admin\(_tenant_id uuid\)[\s\S]*?\$function\$;/i)?.[0];
  if(!adminPredicate) throw new Error('Canonical admin predicate missing');
  await db.exec(adminPredicate);
  // Forward installs complete real driver guards; restore adds the real CAS RPC.
  await applyDriverForward(db);
  await db.exec(source('20260926190733_restore_team_access_public_rpcs.sql'));
  for(const name of ['private.sync_employee_from_tenant_membership_v1()','private.sync_employee_from_workspace_membership_v1()']) {
    const expected=native.find(row=>row.signature===name)!;
    expect((await db.query<{hash:string}>('select md5(prosrc) hash from pg_proc where oid=to_regprocedure($1)',[name])).rows[0].hash).toBe(expected.bodyMd5);
  }
}
async function graph() {
  return (await db.query<Record<string, unknown>>(`select
    (select jsonb_agg(to_jsonb(m) order by tenant_id) from tenant_memberships m where user_id=$1) memberships,
    (select jsonb_agg(to_jsonb(w) order by workspace_id) from workspace_memberships w where user_id=$1) workspaces,
    (select jsonb_agg(to_jsonb(d) order by tenant_id) from drivers d where user_id=$1) drivers,
    (select to_jsonb(p) from profiles p where id=$1) profile,
    (select jsonb_build_object('id',id,'metadata',raw_app_meta_data,'deleted_at',deleted_at) from auth.users where id=$1) identity,
    (select count(*)::int from entity_audit_log) audits`,[id.shared])).rows;
}

async function installPersonProjection() {
  await db.exec(`
    alter table drivers add column workspace_id uuid;
    alter table drivers add column email text;
    alter table drivers add column cpf text;
    alter table drivers add column current_vehicle_id uuid;
    alter table drivers add column created_at timestamptz not null default now();
    alter table drivers add column updated_at timestamptz not null default now();
    update drivers d set workspace_id=t.workspace_id from tenants t where t.id=d.tenant_id;
    create table employees(id uuid primary key);
  `);
  const foundation=source('20260910132428_shared_master_data_foundation.sql');
  for(const table of ['workspace_people','workspace_person_tenant_links']) {
    const definition=foundation.match(new RegExp(`create table public\\.${table} \\([\\s\\S]*?\\n\\);`,'i'))?.[0];
    if(!definition) throw new Error('Canonical projection table missing');
    await db.exec(definition);
  }
  // Existing canonical links, not an uninitialized master-data graph.
  await db.query(`insert into workspace_people(id,workspace_id,identity_key,name)
    select id,workspace_id,'driver:'||id::text,name from drivers where id=$1
    or (id=$2 and workspace_id<>(select workspace_id from drivers where id=$1))`,[id.sharedDriver,id.foreignDriver]);
  await db.query(`insert into workspace_person_tenant_links(workspace_id,workspace_person_id,tenant_id,driver_id)
    select d.workspace_id,case when d.workspace_id=s.workspace_id then s.id else d.id end,d.tenant_id,d.id
    from drivers d cross join drivers s where s.id=$1 and d.id in($1,$2)`,[id.sharedDriver,id.foreignDriver]);
  const projections=source('20260910142232_synchronize_shared_master_projections.sql');
  for(const name of ['apply_shared_projection_columns','insert_shared_projection','sync_workspace_person_projection']) {
    const definition=projections.match(new RegExp(`create or replace function private\\.${name}\\([\\s\\S]*?\\$function\\$;`,'i'))?.[0];
    if(!definition) throw new Error('Canonical projection function missing');
    await db.exec(definition);
  }
  await db.exec(`create trigger drivers_sync_workspace_projection after insert or update on public.drivers
    for each row execute function private.sync_workspace_person_projection();`);
}

const peopleGraph = async () => (await db.query('select * from workspace_people order by id')).rows;
const applyRegistryCorrection=()=>db.exec(source('20261012203921_driver_existing_workspace_projection.sql'));

const candidate='20261012214500_separate_driver_registry_and_suspend_existing_access.sql';
const apply=()=>db.exec(source(candidate));
async function fullSetup(same=true,active=true,role='driver') {
  await setup(same,active,role);await installPersonProjection();await applyRegistryCorrection();
}
async function accessGraph() {
  return (await db.query<Record<string,unknown>>(`select
    (select jsonb_agg(to_jsonb(m) order by id) from tenant_memberships m) memberships,
    (select jsonb_agg(to_jsonb(m) order by id) from workspace_memberships m) workspaces,
    (select jsonb_agg(to_jsonb(u) order by id) from auth.users u) identities,
    (select jsonb_agg(to_jsonb(r) order by id) from user_roles r) roles,
    (select jsonb_agg(to_jsonb(p) order by id) from profiles p) profiles,
    (select jsonb_agg(to_jsonb(p) order by id) from client_portal_access p) portal,
    (select jsonb_agg(to_jsonb(h) order by driver_id) from driver_history_fixture h) history`)).rows;
}
const rename=(driver=id.sharedDriver,name='Synthetic renamed')=>roleQuery(db,'service_role','update drivers set name=$1 where id=$2',[name,driver]);
async function member(user=id.shared) {
  return (await db.query<{id:string;updated_at:string}>('select id,updated_at from tenant_memberships where user_id=$1 and tenant_id=$2',[user,id.tenant])).rows[0];
}
async function suspend(user=id.shared) {
  const row=await member(user);return roleQuery(db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,false)',[row.id,row.updated_at]);
}
async function managed() {
  // Establish shared registries before trusted account attachment, as in the UI flow.
  await rename(id.freeDriver,'Synthetic managed before account');
  await prepare(db);await createAuth(db);
}
const driversGraph=()=>db.query('select * from drivers order by id');

describe('registry separation and existing-operation suspension',()=>{
  it('reproduces managed rename failure after actual reserved Auth INSERT, then fixes both new and existing sibling projections',async()=>{
    await fullSetup();await managed();const before=await accessGraph();
    await expect(rename(id.freeDriver)).rejects.toThrow('managed_driver_invalid_membership');
    expect(await accessGraph()).toEqual(before);await apply();await rename(id.freeDriver);
    expect(await accessGraph()).toEqual(before);
    expect((await db.query('select tenant_id,user_id from drivers where name=$1 order by tenant_id',['Synthetic renamed'])).rows)
      .toEqual([{tenant_id:id.tenant,user_id:id.newUser},{tenant_id:id.otherTenant,user_id:null}]);
    // New legal-company registry projection also receives no implicit access.
    const third='21000000-0000-4000-8000-000000000003';
    await db.query('insert into tenants values($1,$2)',[third,id.workspace]);
    await rename(id.freeDriver,'Synthetic third projection');
    expect((await db.query('select user_id from drivers where tenant_id=$1 and name=$2',[third,'Synthetic third projection'])).rows).toEqual([{user_id:null}]);
    expect((await db.query('select id from tenant_memberships where tenant_id=$1',[third])).rows).toEqual([]);
  });
  it('renames legacy registry with absent sibling membership without provisioning access',async()=>{
    await fullSetup();const before=await accessGraph();
    await expect(rename(id.legacyDriver)).rejects.toThrow('driver_accounts_require_username_creation');
    await apply();await rename(id.legacyDriver);expect(await accessGraph()).toEqual(before);
    expect((await db.query('select tenant_id,user_id from drivers where name=$1 order by tenant_id',['Synthetic renamed'])).rows)
      .toEqual([{tenant_id:id.tenant,user_id:id.legacy},{tenant_id:id.otherTenant,user_id:null}]);
  });
  it.each([{active:false,role:'driver'},{active:true,role:'operator'}])('preserves sibling role=$role active=$active during registry rename',async row=>{
    await fullSetup(true,row.active,row.role);const before=await accessGraph();await apply();await rename();
    expect(await accessGraph()).toEqual(before);
    expect((await db.query('select name from drivers where user_id=$1 order by id',[id.shared])).rows)
      .toEqual([{name:'Synthetic renamed'},{name:'Synthetic renamed'}]);
  });
  it('keeps registry in another workspace unchanged and never overwrites a different destination identity',async()=>{
    await fullSetup(false);await apply();const before=await accessGraph();const foreign=(await db.query('select * from drivers where id=$1',[id.foreignDriver])).rows;
    await rename();expect((await db.query('select * from drivers where id=$1',[id.foreignDriver])).rows).toEqual(foreign);
    expect(await accessGraph()).toEqual(before);
    // The projection helper must preserve destination identity even with a different source user_id.
    await db.query("select private.apply_shared_projection_columns('drivers',to_jsonb(d),$2) from drivers d where id=$1",[id.legacyDriver,id.sharedDriver]);
    expect((await db.query('select user_id from drivers where id=$1',[id.sharedDriver])).rows).toEqual([{user_id:id.shared}]);
  });
  it('reproduces legacy Team suspension rollback, then suspends the operation without changing registry/Auth/roles',async()=>{
    await fullSetup();const before=await accessGraph(),drivers=(await driversGraph()).rows,people=await peopleGraph();
    await expect(suspend()).rejects.toThrow('driver_accounts_require_username_creation');expect(await accessGraph()).toEqual(before);
    await apply();await suspend();const after=await accessGraph();
    for(const key of ['identities','roles','profiles','portal','history']) expect(after[0][key]).toEqual(before[0][key]);
    expect((await driversGraph()).rows).toEqual(drivers);expect(await peopleGraph()).toEqual(people);
    expect((await db.query('select active,role from tenant_memberships where user_id=$1 order by tenant_id',[id.shared])).rows)
      .toEqual([{active:false,role:'driver'},{active:false,role:'driver'}]);
    expect((await db.query('select active from workspace_memberships where user_id=$1',[id.shared])).rows).toEqual([{active:false}]);
    expect((await db.query('select count(*)::int n from entity_audit_log where entity_type=\'tenant_membership\'')).rows).toEqual([{n:2}]);
    const current=await member();await expect(roleQuery(db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,true)',[current.id,current.updated_at]))
      .rejects.toThrow('driver_accounts_require_username_creation');
  });
  it('managed account suspension does not manufacture sibling memberships or require a workspace membership',async()=>{
    await fullSetup();await managed();await expect(suspend(id.newUser)).rejects.toThrow('managed_driver_invalid_membership');
    const drivers=(await driversGraph()).rows,before=await accessGraph();await apply();await suspend(id.newUser);
    expect((await driversGraph()).rows).toEqual(drivers);
    expect((await db.query('select tenant_id,active from tenant_memberships where user_id=$1',[id.newUser])).rows).toEqual([{tenant_id:id.tenant,active:false}]);
    expect((await db.query('select id from workspace_memberships where user_id=$1',[id.newUser])).rows).toEqual([]);
    expect((await accessGraph())[0].identities).toEqual(before[0].identities);
  });
  it('preserves another operation and its active access when the same identity is suspended here',async()=>{
    await fullSetup(false);await apply();const before=await accessGraph();await suspend();
    expect((await db.query('select tenant_id,active from tenant_memberships where user_id=$1 order by tenant_id',[id.shared])).rows)
      .toEqual([{tenant_id:id.tenant,active:false},{tenant_id:id.otherTenant,active:true}]);
    expect((await db.query('select workspace_id,active from workspace_memberships where user_id=$1 order by workspace_id',[id.shared])).rows)
      .toEqual([{workspace_id:id.workspace,active:false},{workspace_id:id.otherWorkspace,active:true}]);
    expect((await accessGraph())[0].identities).toEqual(before[0].identities);
  });
  it('covers the workspace membership entry without inserts or changes to registry',async()=>{
    await fullSetup();await apply();const before=(await driversGraph()).rows;
    await roleQuery(db,'service_role','update workspace_memberships set active=false where user_id=$1 and workspace_id=$2',[id.shared,id.workspace]);
    expect((await db.query('select active from tenant_memberships where user_id=$1',[id.shared])).rows).toEqual([{active:false},{active:false}]);
    expect((await driversGraph()).rows).toEqual(before);
  });
  it.each(['operator','owner'])('rejects mixed %s membership atomically instead of demoting or disabling it',async role=>{
    await fullSetup(true,true,role);await apply();const before=await graph();
    await expect(suspend()).rejects.toThrow('driver_suspension_mixed_operation_roles');expect(await graph()).toEqual(before);
  });
  it('keeps CAS, owner and caller authorization boundaries',async()=>{
    await fullSetup();await apply();const row=await member(),before=await graph();
    await expect(roleQuery(db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,false)',[row.id,'2000-01-01T00:00:00Z'])).rejects.toThrow('membership_revision_conflict');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id.operator]);
    await expect(suspend()).rejects.toThrow('not_authorized');expect(await graph()).toEqual(before);
    await db.query("select set_config('request.jwt.claim.sub',$1,false)",[id.otherAdmin]);
    const owner=(await db.query<{id:string;updated_at:string}>('select id,updated_at from tenant_memberships where user_id=$1',[id.otherAdmin])).rows[0];
    await expect(roleQuery(db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,false)',[owner.id,owner.updated_at])).rejects.toThrow('owner_membership_immutable');
  });
  it('keeps global account guards and direct managed-link prohibitions',async()=>{
    await fullSetup();await managed();await apply();
    await expect(scope(db,id.shared,false)).rejects.toThrow('driver_account_shared_or_other_role');
    await expect(roleQuery(db,'service_role',"insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[id.otherTenant,id.newUser])).rejects.toThrow('managed_driver_invalid_membership');
    await expect(roleQuery(db,'service_role','update drivers set user_id=$1 where id=$2',[id.newUser,id.secondDriver])).rejects.toThrow('managed_driver_invalid_link');
  });
  it('rolls back the complete suspension if an audit fails on a sibling',async()=>{
    await fullSetup();await apply();const before=await graph();
    await db.exec(`create function public.fail_synthetic_audit() returns trigger language plpgsql as $$begin
      if new.tenant_id='${id.otherTenant}'::uuid then raise exception 'synthetic_audit_failure';end if;return new;end;$$;
      create trigger fail_synthetic_audit before insert on entity_audit_log for each row execute function fail_synthetic_audit();`);
    await expect(suspend()).rejects.toThrow('synthetic_audit_failure');expect(await graph()).toEqual(before);
  });
  it('preserves all existing metadata/ACL and guards, has no DML on apply, and is idempotent',async()=>{
    await fullSetup();const metadata=()=>db.query("select oid,to_jsonb(p)-'prosrc' value from pg_proc p where pronamespace='private'::regnamespace order by oid");
    const guards=()=>db.query("select prosrc from pg_proc where oid='private.guard_driver_account_scope_v1()'::regprocedure");
    const before=(await metadata()).rows,guard=(await guards()).rows,data=await accessGraph();await apply();await apply();
    expect((await metadata()).rows).toEqual(before);expect((await guards()).rows).toEqual(guard);expect(await accessGraph()).toEqual(data);
  });
  it.each(['predecessor','scope_trigger'])('refuses unknown %s atomically',async variant=>{
    await fullSetup();
    if(variant==='scope_trigger') await db.exec('alter table tenant_memberships disable trigger guard_driver_tenant_scope');
    else await db.exec("create or replace function private.sync_employee_from_workspace_membership_v1() returns trigger language plpgsql security definer set search_path='' as $$begin return new;end;$$");
    const bodies=()=>db.query("select oid,prosrc from pg_proc where pronamespace='private'::regnamespace order by oid");
    const before=(await bodies()).rows,data=await accessGraph();
    await expect(apply()).rejects.toThrow(variant==='scope_trigger'?'driver_registry_suspension_scope_guard_changed':'driver_registry_suspension_predecessor_changed');
    expect((await bodies()).rows).toEqual(before);expect(await accessGraph()).toEqual(data);
  });
});
