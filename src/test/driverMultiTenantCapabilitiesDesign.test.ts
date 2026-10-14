// @vitest-environment node
// Current SQL bodies and candidate migration, synthetic rows, isolated PGlite.
// This partial graph is not a substitute for Native/RLS release validation.
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterEach, describe, expect, it } from 'vitest';
import { applyDriverForward, id, roleQuery, scope, setupDriverGraph } from './helpers/driverAccessDatabaseFixture';

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

describe('design boundary: local registry, local membership, global identity', () => {
  it.each([true,false])('current Team CAS deactivation rolls back with legacy driver guards, same workspace=%s',async sameWorkspace=>{
    await setup(sameWorkspace);
    const before=await graph();
    const member=(await db.query<{id:string;updated_at:string}>(
      'select id,updated_at from tenant_memberships where tenant_id=$1 and user_id=$2',[id.tenant,id.shared])).rows[0];
    await expect(roleQuery(db,'authenticated','select public.update_tenant_membership_v1($1,$2,null,false)',
      [member.id,member.updated_at])).rejects.toThrow('driver_accounts_require_username_creation');
    expect(await graph()).toEqual(before);
  });
  it('local registry data is available even though exclusive global-account inspection rejects it',async()=>{
    await setup(true);
    await expect(scope(db,id.shared,false)).rejects.toThrow('driver_account_shared_or_other_role');
    // Projection example only; authorization remains a prerequisite, not supplied by this SELECT.
    const local=(await db.query(`select d.id driver_id,d.name,m.id membership_id,m.active membership_active
      from drivers d left join tenant_memberships m on m.tenant_id=d.tenant_id and m.user_id=d.user_id
      where d.tenant_id=$1 and d.user_id=$2`,[id.tenant,id.shared])).rows;
    expect(local).toHaveLength(1);
    expect(local[0]).toMatchObject({driver_id:id.sharedDriver,name:'Shared',membership_active:true});
    expect(local[0]).not.toHaveProperty('email');
    expect(local[0]).not.toHaveProperty('other_tenants');
    expect((await db.query('select id from drivers where tenant_id=$1 and user_id=$2',[id.tenant,id.otherAdmin])).rows).toEqual([]);
  });
  it('registry name and phone are local with membership sync alone, before installing shared-person projection',async()=>{
    await setup(true); const before=await graph();
    await roleQuery(db,'service_role','update drivers set name=$1,phone=$2,user_id=$3,tenant_id=$4 where id=$5 and tenant_id=$4',
      ['Local synthetic name','synthetic phone',id.shared,id.tenant,id.sharedDriver]);
    const after=await graph();
    for(const key of ['memberships','workspaces','profile','identity','audits']) expect(after[0][key]).toEqual(before[0][key]);
    const foreign=(rows:typeof before)=>(rows[0].drivers as Array<{tenant_id:string}>).filter(row=>row.tenant_id===id.otherTenant);
    expect(foreign(after)).toEqual(foreign(before));
    expect((await db.query('select name,phone from drivers where id=$1',[id.sharedDriver])).rows)
      .toEqual([{name:'Local synthetic name',phone:'synthetic phone'}]);
  });
  it('profiles.full_name has one global value visible through both memberships',async()=>{
    await setup(true);
    // Demonstrates schema semantics with a synthetic row, not permission to expose a global editor.
    await db.query('update profiles set full_name=$1 where id=$2',['Changed global synthetic name',id.shared]);
    expect((await db.query(`select p.full_name from tenant_memberships m join profiles p on p.id=m.user_id
      where m.user_id=$1 order by m.tenant_id`,[id.shared])).rows)
      .toEqual([{full_name:'Changed global synthetic name'},{full_name:'Changed global synthetic name'}]);
    expect((await db.query('select name from drivers where user_id=$1 order by tenant_id',[id.shared])).rows)
      .toEqual([{name:'Shared'},{name:'Foreign'}]);
  });
  it.each(['name','current_vehicle_id'])('shared-person projection blocks even a %s update in a sibling-company workspace',async column=>{
    await setup(true); await installPersonProjection(); const before=await graph(), people=await peopleGraph();
    const statement=column==='name'?'update drivers set name=$1 where id=$2 and tenant_id=$3'
      :'update drivers set current_vehicle_id=$1 where id=$2 and tenant_id=$3';
    const value=column==='name'?'Synthetic new name':'51000000-0000-4000-8000-000000000001';
    await expect(roleQuery(db,'service_role',statement,[value,id.sharedDriver,id.tenant]))
      .rejects.toThrow('driver_accounts_require_username_creation');
    expect(await graph()).toEqual(before);
    expect(await peopleGraph()).toEqual(people);
  });
  it.each([false,true])('linked registry update stays isolated across different workspaces, candidate=%s',async candidate=>{
    await setup(false); await installPersonProjection(); const before=await graph();
    if(candidate) await applyRegistryCorrection();
    await roleQuery(db,'service_role','update drivers set name=$1 where id=$2 and tenant_id=$3',
      ['Synthetic local-workspace name',id.sharedDriver,id.tenant]);
    const after=await graph();
    for(const key of ['memberships','workspaces','profile','identity','audits']) expect(after[0][key]).toEqual(before[0][key]);
    const foreign=(rows:typeof before)=>(rows[0].drivers as Array<{tenant_id:string}>).filter(row=>row.tenant_id===id.otherTenant);
    expect(foreign(after)).toEqual(foreign(before));
    expect((await db.query('select workspace_id,name from workspace_people where workspace_id=$1',[id.workspace])).rows)
      .toEqual([{workspace_id:id.workspace,name:'Synthetic local-workspace name'}]);
  });
  it('an unlinked registry name is actually projected into the sibling company',async()=>{
    await setup(true); await installPersonProjection();
    await roleQuery(db,'service_role','update drivers set name=$1 where id=$2 and tenant_id=$3',
      ['Synthetic shared-workspace name',id.freeDriver,id.tenant]);
    expect((await db.query('select tenant_id,user_id from drivers where name=$1 order by tenant_id',
      ['Synthetic shared-workspace name'])).rows)
      .toEqual([{tenant_id:id.tenant,user_id:null},{tenant_id:id.otherTenant,user_id:null}]);
    expect((await db.query(`select count(*)::int count from workspace_person_tenant_links l join workspace_people p
      on p.id=l.workspace_person_id where p.name=$1`,['Synthetic shared-workspace name'])).rows).toEqual([{count:2}]);
  });
  it('candidate preserves existing access while updating a shared registry across two CNPJs in the same workspace',async()=>{
    await setup(true); await installPersonProjection(); const before=await graph();
    await expect(roleQuery(db,'service_role','update drivers set name=$1 where id=$2',
      ['Synthetic shared rename',id.sharedDriver])).rejects.toThrow('driver_accounts_require_username_creation');
    await applyRegistryCorrection();
    await roleQuery(db,'service_role','update drivers set name=$1 where id=$2',
      ['Synthetic shared rename',id.sharedDriver]);
    const after=await graph();
    for(const key of ['memberships','workspaces','profile','identity','audits']) expect(after[0][key]).toEqual(before[0][key]);
    expect((await db.query('select name from drivers where id in($1,$2) order by id',[id.sharedDriver,id.foreignDriver])).rows)
      .toEqual([{name:'Synthetic shared rename'},{name:'Synthetic shared rename'}]);
    // A registry repair does not silently broaden global credential administration.
    await expect(scope(db,id.shared,false)).rejects.toThrow('driver_account_shared_or_other_role');
  });
  it('candidate local-only vehicle column update has no shared-person or other-company side effect',async()=>{
    await setup(true); await installPersonProjection(); await applyRegistryCorrection();
    const before=await graph(),people=await peopleGraph();
    await roleQuery(db,'service_role','update drivers set current_vehicle_id=$1 where id=$2 and tenant_id=$3',
      ['51000000-0000-4000-8000-000000000001',id.sharedDriver,id.tenant]);
    const after=await graph();
    for(const key of ['memberships','workspaces','profile','identity','audits']) expect(after[0][key]).toEqual(before[0][key]);
    expect(await peopleGraph()).toEqual(people);
    expect((await db.query('select current_vehicle_id from drivers where id=$1',[id.foreignDriver])).rows)
      .toEqual([{current_vehicle_id:null}]);
  });
  it('candidate still refuses to implicitly provision a missing legacy driver membership',async()=>{
    await setup(true); await installPersonProjection(); await applyRegistryCorrection();
    // An unshared legacy account has no membership in the sibling company.
    const before=await graph();
    await expect(roleQuery(db,'service_role','update drivers set name=$1 where id=$2',
      ['Synthetic legacy rename',id.legacyDriver])).rejects.toThrow('driver_accounts_require_username_creation');
    expect(await graph()).toEqual(before);
    expect((await db.query('select id from tenant_memberships where user_id=$1 and tenant_id=$2',[id.legacy,id.otherTenant])).rows).toEqual([]);
  });
  it.each([{active:false,role:'driver'},{active:true,role:'operator'}])('candidate preserves existing membership $role active=$active, rather than reactivating or demoting it',async target=>{
    await setup(true,target.active,target.role); await installPersonProjection(); await applyRegistryCorrection();
    const before=await graph();
    await roleQuery(db,'service_role','update drivers set name=$1 where id=$2 and tenant_id=$3',
      ['Synthetic shared rename',id.sharedDriver,id.tenant]);
    const after=await graph();
    for(const key of ['memberships','workspaces','profile','identity','audits']) expect(after[0][key]).toEqual(before[0][key]);
    await expect(scope(db,id.shared,false)).rejects.toThrow('driver_account_shared_or_other_role');
  });
  it('candidate is idempotent, preserves function metadata and does not alter the global identity guards',async()=>{
    await setup(true); await installPersonProjection();
    const metadata=async()=> (await db.query(`select to_jsonb(p)-'prosrc' value from pg_proc p
      where oid='private.sync_workspace_person_projection()'::regprocedure`)).rows;
    const guards=async()=> (await db.query(`select oid,md5(prosrc) hash from pg_proc where oid in(
      'private.driver_access_scope_v1(uuid,uuid,uuid,boolean)'::regprocedure,
      'private.guard_driver_account_scope_v1()'::regprocedure)`)).rows;
    const before=await metadata(), guardBefore=await guards(), dataBefore=await graph();
    await applyRegistryCorrection(); await applyRegistryCorrection();
    expect(await metadata()).toEqual(before); expect(await guards()).toEqual(guardBefore);
    expect(await graph()).toEqual(dataBefore);
  });
});
