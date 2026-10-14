// @vitest-environment node
// Synthetic partial SQL graph only; no real Auth, customer rows or shared database.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
vi.hoisted(()=>vi.stubGlobal('Deno',{env:{get:()=>undefined}}));
import * as f from './helpers/driverCredentialCombinedFixture';
import {id,roleQuery} from './helpers/driverAccessDatabaseFixture';

afterEach(async()=>{await f.db?.close();});
const driverLink=async(driver=id.freeDriver)=>(await f.db.query('select id,user_id from drivers where id=$1',[driver])).rows;
const migration='supabase/migrations/20261013025826_driver_native_link_registry_protection.sql';
const proposal=()=>f.db.exec(readFileSync(migration,'utf8'));
async function activate(user=id.newUser){const row=await f.member(user);return roleQuery(f.db,'authenticated',
  'select public.update_tenant_membership_v1($1,$2,null,true)',[row.id,row.updated_at]);}

describe('complementary shared lifecycle boundaries',()=>{
  it('binds the CLI-generated migration to the reviewed bytes and closed supplement inventory',()=>{
    const actual=readFileSync(migration),reviewed=readFileSync('docs/qa/driver-shared-lifecycle-link-protection-proposal.sql');
    expect(actual.equals(reviewed)).toBe(true);
    expect(createHash('sha256').update(actual).digest('hex')).toBe('95de856507b8cd7a30b0844707dba2707e20d624927e193452f535503053f074');
    expect(actual.includes(Buffer.from('\r\n'))).toBe(false);
    const inventory=JSON.parse(readFileSync('docs/qa/baseline-supplement-manifest.json','utf8')) as {forwards:Array<{version:string;filename:string;sha256:string}>};
    const historical = inventory.forwards.filter(item => item.filename === '20261013025826_driver_native_link_registry_protection.sql');
    expect(historical).toHaveLength(1);
    expect(historical[0]).toEqual({version:'20261013025826',filename:'20261013025826_driver_native_link_registry_protection.sql',sha256:'95de856507b8cd7a30b0844707dba2707e20d624927e193452f535503053f074'});
  });

  it('does not allow a directly created username identity to be unlinked by registry editing',async()=>{
    await f.setupCombinedDriverCredentials();await f.managed();
    const before=await driverLink();await proposal();
    await expect(roleQuery(f.db,'service_role','update drivers set user_id=null where id=$1',[id.freeDriver]))
      .rejects.toMatchObject({code:'42501'});
    expect(await driverLink()).toEqual(before);
  });
  it('retains the same unlink protection for a converted shared identity',async()=>{
    await f.setupCombinedDriverCredentials();
    await roleQuery(f.db,'service_role','select public.prepare_driver_workspace_credentials_v1($1,$2,$3,$4,$5,$6,$7,$8)',
      [id.tenant,id.admin,id.shared,f.request,'convert',f.login,f.nonce,id.sharedDriver]);
    await f.authUpdate();const before=await driverLink(id.sharedDriver);await proposal();
    await expect(roleQuery(f.db,'service_role','update drivers set user_id=null where id=$1',[id.sharedDriver]))
      .rejects.toMatchObject({code:'42501'});
    expect(await driverLink(id.sharedDriver)).toEqual(before);
  });
  it('reproduces unlink and deletion before the proposal without modifying Auth or membership',async()=>{
    await f.setupCombinedDriverCredentials();await f.managed();
    const access=await f.accessGraph();
    await f.db.exec('begin;set local role service_role');
    await f.db.query('update drivers set user_id=null where id=$1',[id.freeDriver]);
    await f.db.exec('reset role');
    expect(await driverLink()).toEqual([{id:id.freeDriver,user_id:null}]);
    expect(await f.accessGraph()).toEqual(access);
    await f.db.exec('rollback');
    await f.db.exec('begin;set local role service_role');
    await f.db.query('delete from drivers where id=$1',[id.freeDriver]);
    await f.db.exec('reset role');
    expect(await driverLink()).toEqual([]);
    await f.db.exec('rollback');
    expect(await driverLink()).toEqual([{id:id.freeDriver,user_id:id.newUser}]);
  });
  it('blocks replacement and deletion of a directly created identity and preserves legitimate lifecycle operations',async()=>{
    await f.setupCombinedDriverCredentials();await proposal();await f.managed();
    const before=await f.accessGraph(),links=await driverLink();
    for(const user of [null,id.legacy,id.operator])
      await expect(roleQuery(f.db,'service_role','update drivers set user_id=$1 where id=$2',[user,id.freeDriver]))
        .rejects.toMatchObject({code:'42501'});
    await expect(roleQuery(f.db,'service_role','delete from drivers where id=$1',[id.freeDriver]))
      .rejects.toMatchObject({code:'42501'});
    expect(await driverLink()).toEqual(links);expect(await f.accessGraph()).toEqual(before);
    await f.rename(id.freeDriver,'Synthetic safe edit');await f.suspend(id.newUser);await activate();
    expect(await driverLink()).toEqual(links);
    expect((await f.db.query('select tenant_id,role,active from tenant_memberships where user_id=$1',[id.newUser])).rows)
      .toEqual([{tenant_id:id.tenant,role:'driver',active:true}]);
    expect((await f.accessGraph())[0].identities).toEqual(before[0].identities);
  });
  it('preserves function metadata, performs no data repair and is idempotent',async()=>{
    await f.setupCombinedDriverCredentials();await f.managed();
    const signatures=['private.guard_driver_account_scope_v1()','private.protect_converted_driver_registry_delete_v1()'];
    const metadata=async()=>(await f.db.query("select to_jsonb(p)-'prosrc' value from pg_proc p where oid=any($1::regprocedure[]) order by oid",[signatures])).rows;
    const before=await metadata(),access=await f.accessGraph(),drivers=(await f.driversGraph()).rows;
    await proposal();await proposal();
    expect(await metadata()).toEqual(before);expect(await f.accessGraph()).toEqual(access);expect((await f.driversGraph()).rows).toEqual(drivers);
  });
  it('rolls back the first function patch when a later predecessor is unknown',async()=>{
    await f.setupCombinedDriverCredentials();
    await f.db.exec("create or replace function private.protect_converted_driver_registry_delete_v1() returns trigger language plpgsql security definer set search_path='' as $$begin return old;end;$$");
    const bodies=async()=>(await f.db.query("select oid,prosrc from pg_proc where pronamespace='private'::regnamespace order by oid")).rows;
    const before=await bodies();await expect(proposal()).rejects.toThrow('driver_link_protection_predecessor_changed');
    expect(await bodies()).toEqual(before);
  });
  it('does not alter foreign-company or other-role rejection when a new username account is suspended',async()=>{
    await f.setupCombinedDriverCredentials();await proposal();await f.managed();await f.suspend(id.newUser);
    const before=await f.accessGraph();
    await expect(roleQuery(f.db,'service_role',"insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[id.otherTenant,id.newUser]))
      .rejects.toThrow('managed_driver_invalid_membership');
    await expect(roleQuery(f.db,'service_role',"update tenant_memberships set role='operator' where user_id=$1",[id.newUser]))
      .rejects.toThrow('managed_driver_invalid_membership');
    expect(await f.accessGraph()).toEqual(before);
  });
  it('keeps shared employee projections separate from account links, sibling employment fields and another workspace',async()=>{
    await f.setupCombinedDriverCredentials();await proposal();
    await f.db.exec(`alter table employees
      add column tenant_id uuid,add column workspace_id uuid,add column name text,add column email text,add column phone text,
      add column doc_cpf text,add column status text,add column user_id uuid,add column driver_id uuid,add column manager_id uuid,
      add column branch text,add column cost_center text,add column hire_date date,add column termination_date date,add column version integer default 1,
      add column created_at timestamptz default now(),add column updated_at timestamptz default now(),add column created_by uuid,add column updated_by uuid;
      create trigger employees_sync_workspace_projection after insert or update on employees
        for each row execute function private.sync_workspace_person_projection();`);
    const employee='81000000-0000-4000-8000-000000000001',foreign='81000000-0000-4000-8000-000000000002',tenant='21000000-0000-4000-8000-000000000003';
    await f.db.query('insert into tenants values($1,$2)',[tenant,id.otherWorkspace]);
    const access=await f.accessGraph(),drivers=(await f.driversGraph()).rows;
    await f.db.query(`insert into employees(id,tenant_id,workspace_id,name,doc_cpf,status,user_id,driver_id,branch,cost_center)
      values($1,$2,$3,'Synthetic employee','00000000000','active',$4,$5,'local branch','local cost')`,[employee,id.tenant,id.workspace,id.operator,id.sharedDriver]);
    const sibling=(await f.db.query<{id:string}>('select id from employees where tenant_id=$1',[id.otherTenant])).rows[0];
    expect(sibling).toBeDefined();
    expect((await f.db.query('select user_id,driver_id,manager_id from employees where id=$1',[sibling.id])).rows)
      .toEqual([{user_id:null,driver_id:null,manager_id:null}]);
    await f.db.query("update employees set user_id=$1,branch='sibling branch',cost_center='sibling cost' where id=$2",[id.legacy,sibling.id]);
    await f.db.query("insert into employees(id,tenant_id,workspace_id,name,doc_cpf,status) values($1,$2,$3,'Foreign employee','00000000000','active')",[foreign,tenant,id.otherWorkspace]);
    const foreignBefore=(await f.db.query('select * from employees where id=$1',[foreign])).rows;
    await f.db.query("update employees set name='Edited employee',status='inactive' where id=$1",[employee]);
    expect((await f.db.query('select name,status,user_id,branch,cost_center from employees where id=$1',[sibling.id])).rows)
      .toEqual([{name:'Edited employee',status:'inactive',user_id:id.legacy,branch:'sibling branch',cost_center:'sibling cost'}]);
    expect((await f.db.query('select * from employees where id=$1',[foreign])).rows).toEqual(foreignBefore);
    expect(await f.accessGraph()).toEqual(access);expect((await f.driversGraph()).rows).toEqual(drivers);
    await f.db.query("update employees set status='active' where id=$1",[employee]);
    expect((await f.db.query('select status from employees where id=$1',[sibling.id])).rows).toEqual([{status:'active'}]);
    expect(await f.accessGraph()).toEqual(access);
  });
});
