// @vitest-environment node
// Native authorization graph reproduced on isolated PostgreSQL; native acceptance remains required.
import { PGlite } from '@electric-sql/pglite';
import { afterEach,describe,expect,it } from 'vitest';
import {functions,graph,id,repair,request,rollback,setup,visible} from './helpers/assignedIncidentPersonnelFixture';
let db:PGlite;afterEach(async()=>{await db?.close();});
describe('A6 assigned incident reads with ORIGINAL restrictive RH policies',()=>{
 it.each([false,true])('reproduces old failure and repairs only own reads; snapshot=%s',async snapshot=>{
  db=await setup(snapshot);
  expect(await visible(db,id.assigned,'employees')).toEqual([]);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([]);
  expect(await visible(db,id.assigned,'employee_incident_actions')).toEqual([]);
  const before=await graph(db);await db.exec(repair);expect(await graph(db)).toEqual(before);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([id.responsible]);
  expect(await visible(db,id.assigned,'employee_incident_actions')).toEqual([id.action]);
  expect(await visible(db,id.assigned,'employees')).toEqual([]);
  for(const actor of [id.admin,id.operator]){
   expect(await visible(db,actor,'incident_responsible')).toEqual([id.responsible,id.peerResponsible]);
   expect(await visible(db,actor,'employee_incident_actions')).toEqual([id.action,id.peerAction]);
   expect(await visible(db,actor,'employees')).toEqual([id.employee,id.peerEmployee]);
  }
  await db.query("update tenant_memberships set role='owner' where user_id=$1",[id.admin]);
  expect(await visible(db,id.admin,'incident_responsible')).toEqual([id.responsible,id.peerResponsible]);
  await db.exec(repair);expect(await graph(db)).toEqual(before);
 },30_000);
 it.each([false,true])('rejects stale binding and keeps snapshot protection; snapshot=%s',async snapshot=>{
  db=await setup(snapshot);await db.exec(repair);
  await db.query('update employees set user_id=$1 where id=$2',[id.peer,id.employee]);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([]);
  expect(await visible(db,id.assigned,'employee_incident_actions')).toEqual([]);
  expect(await visible(db,id.peer,'incident_responsible')).toEqual(snapshot?[id.peerResponsible]:[id.responsible,id.peerResponsible]);
  expect(await visible(db,id.peer,'employee_incident_actions')).toEqual([id.action,id.peerAction]);
 },30_000);
 it.each(['employee','membership','role','workspace'])('denies inactive/inconsistent %s immediately',async kind=>{
  db=await setup();await db.exec(repair);
  if(kind==='employee') await db.query("update employees set status='inactive' where id=$1",[id.employee]);
  if(kind==='membership') await db.query('update tenant_memberships set active=false where user_id=$1',[id.assigned]);
  if(kind==='role') await db.query("update tenant_memberships set role='client' where user_id=$1",[id.assigned]);
  if(kind==='workspace') await db.query('update employees set workspace_id=$1 where id=$2',[id.otherWorkspace,id.employee]);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([]);
  expect(await visible(db,id.assigned,'employee_incident_actions')).toEqual([]);
 },30_000);
 it('denies pure portal/anon/foreign and permits active internal membership with a portal record',async()=>{
  db=await setup();await db.exec(repair);
  await db.query('update employees set user_id=$1 where id=$2',[id.client,id.employee]);
  expect(await visible(db,id.client,'incident_responsible')).toEqual([]);
  expect(await visible(db,id.client,'employee_incident_actions')).toEqual([]);
  expect(await visible(db,null,'incident_responsible',{role:'anon'})).toEqual([]);
  expect(await visible(db,id.foreign,'incident_responsible')).toEqual([]);
  await db.query('update employees set user_id=$1 where id=$2',[id.assigned,id.employee]);
  await db.query('insert into client_portal_access values($1,$2,true)',[id.tenant,id.assigned]);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([id.responsible]);
  expect(await visible(db,id.foreign,'incident_responsible',{tenant:id.otherTenant,workspace:id.otherWorkspace})).toEqual([id.foreignResponsible]);
 },30_000);
 it('helper returns only a boolean and closes null/foreign/malformed inputs and missing signed context',async()=>{
  db=await setup();await db.exec(repair);
const query='select private.is_assigned_incident_employee_v1($1,$2) allowed';
  expect((await request(db,id.assigned,query,[id.tenant,id.employee])).rows).toEqual([{allowed:true}]);
  for(const args of [[null,id.employee],[id.tenant,null],[id.tenant,id.peerEmployee],[id.otherTenant,id.employee]])
   expect((await request(db,id.assigned,query,args)).rows).toEqual([{allowed:false}]);
  await expect(request(db,id.assigned,query,['not-uuid',id.employee])).rejects.toMatchObject({code:'22P02'});
  await expect(request(db,id.assigned,query,[id.tenant,id.employee],{claims:{active_tenant_id:null}})).rejects.toMatchObject({code:'42501'});
  await expect(request(db,id.assigned,query,[id.tenant,id.employee],{headers:JSON.stringify({'x-agvlog-tenant-id':id.otherTenant})})).rejects.toMatchObject({code:'42501'});
  await expect(request(db,id.assigned,query,[id.tenant,id.employee],{headers:'malformed'})).rejects.toMatchObject({code:'22023'});
  expect((await request(db,id.assigned,query,[id.tenant,id.employee],{workspace:id.otherWorkspace})).rows).toEqual([{allowed:false}]);
  expect((await request(db,null,query,[id.tenant,id.employee])).rows).toEqual([{allowed:false}]);
  expect((await request(db,id.assigned,query,[id.tenant,id.employee],{claims:{active_workspace_id:null}})).rows).toEqual([{allowed:false}]);
  await expect(request(db,id.assigned,query,[id.tenant,id.employee],{claims:{active_workspace_id:'bad-uuid'}})).rejects.toMatchObject({code:'22P02'});
  expect((await request(db,id.assigned,query,[id.tenant,id.employee],{headers:'{}'})).rows).toEqual([{allowed:true}]);
  await db.query('delete from tenant_memberships where user_id=$1',[id.assigned]);
  expect((await request(db,id.assigned,query,[id.tenant,id.employee])).rows).toEqual([{allowed:false}]);
  await expect(request(db,null,query,[id.tenant,id.employee],{role:'anon'})).rejects.toMatchObject({code:'42501'});
 },30_000);
 it('adds no RH leakage or employee/incident write authorization',async()=>{
  db=await setup();await db.exec(repair);
  expect((await request(db,id.assigned,'select doc_cpf,notes from employees')).rows).toEqual([]);
  for(const table of ['employees','incident_responsible','employee_incident_actions']){
   expect((await request(db,id.assigned,`update ${table} set ${table==='employees'?'name':'description'}='unauthorized' returning id`)).rows).toEqual([]);
   expect((await request(db,id.assigned,`delete from ${table} returning id`)).rows).toEqual([]);
  }
  await expect(request(db,id.assigned,"insert into incident_responsible(id,tenant_id,employee_id,incident_id) values(gen_random_uuid(),$1,$2,$1)",[id.tenant,id.employee])).rejects.toMatchObject({code:'42501'});
  await expect(request(db,id.assigned,"insert into employee_incident_actions(id,tenant_id,employee_id,incident_id) values(gen_random_uuid(),$1,$2,$1)",[id.tenant,id.employee])).rejects.toMatchObject({code:'42501'});
  await expect(request(db,id.assigned,"insert into employees(id,tenant_id,workspace_id,user_id,name) values(gen_random_uuid(),$1,$2,$3,'Synthetic')",[id.tenant,id.workspace,id.assigned])).rejects.toMatchObject({code:'42501'});
 },30_000);
 it('rolls back whole forward and rejects policy/helper predecessor or ACL drift',async()=>{
  db=await setup();const before=await graph(db);
  await db.exec('begin');await db.exec(repair);await db.exec('rollback');
  expect(await graph(db)).toEqual(before);
  expect((await db.query("select to_regprocedure('private.is_assigned_incident_employee_v1(uuid,uuid)') signature")).rows).toEqual([{signature:null}]);
  await db.exec('alter policy agvlog_select_authenticated on employees using(true)');
  await expect(db.exec(repair)).rejects.toThrow('protected_policy_changed');
  await db.exec('alter policy agvlog_select_authenticated on employees using(is_tenant_operator_or_admin(tenant_id))');
  await db.exec(repair);
  await db.exec('grant execute on function private.is_assigned_incident_employee_v1(uuid,uuid) to anon');
  await expect(db.exec(repair)).rejects.toThrow('helper_metadata_or_acl_changed');
 },30_000);
 it('rejects changed authorization dependency body',async()=>{
  db=await setup();await db.exec("create or replace function private.request_tenant_id() returns uuid language plpgsql stable set search_path='' as $$begin return null;end$$");
  await expect(db.exec(repair)).rejects.toThrow('authorization_predecessor_changed');
  },30_000);
 it.each(functions.filter(row=>row.signature!=='public.is_tenant_admin(uuid)').flatMap(row=>
  ['config','owner','acl','volatile','definer','language','signature'].map(kind=>({row,kind}))))('rejects native metadata drift $kind on $row.signature',async({row,kind})=>{
   db=await setup();
   if(kind==='config') await db.exec(`alter function ${row.signature} set request.jwt.claim.sub='${id.peer}'`);
   if(kind==='owner') await db.exec(`alter function ${row.signature} owner to ${row.ownerName==='postgres'?'supabase_auth_admin':'postgres'}`);
   if(kind==='acl') await db.exec(`grant execute on function ${row.signature} to anon`);
   if(kind==='volatile') await db.exec(`alter function ${row.signature} volatile`);
   if(kind==='definer') await db.exec(`alter function ${row.signature} ${row.definition.includes('SECURITY DEFINER')?'security invoker':'security definer'}`);
   if(kind==='language'){
    await db.exec('set check_function_bodies=off');
    await db.exec(row.definition.replace(/LANGUAGE (sql|plpgsql)/,(_,language:string)=>`LANGUAGE ${language==='sql'?'plpgsql':'sql'}`)+';');
   }
   if(kind==='signature') await db.exec(`alter function ${row.signature} rename to a6_changed_signature`);
   await expect(db.exec(repair)).rejects.toThrow(/authorization_(metadata_or_acl|predecessor)_changed/);
  },30_000);
 it('rejects unexpected default EXEC ACL on first creation atomically',async()=>{
  db=await setup();const before=await graph(db);
  await db.exec('create role unexpected_reader;alter default privileges in schema private grant execute on functions to unexpected_reader');
  await expect(db.exec(repair)).rejects.toThrow('helper_metadata_or_acl_changed');
  expect(await graph(db)).toEqual(before);
  expect((await db.query("select to_regprocedure('private.is_assigned_incident_employee_v1(uuid,uuid)') signature")).rows).toEqual([{signature:null}]);
 },30_000);
 it.each([null,id.peer])('keeps snapshot %s separate from current binding',async snapshot=>{
  db=await setup(true);await db.exec(repair);
  await db.query('update incident_responsible set assigned_user_id=$1 where id=$2',[snapshot,id.responsible]);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([]);
  expect(await visible(db,id.assigned,'employee_incident_actions')).toEqual([id.action]);
 },30_000);
 it('rejects unexpected snapshot type and mixed application',async()=>{
  db=await setup(true);
  await db.exec('drop policy "Assigned employees and operators can view incident_responsible" on incident_responsible;alter table incident_responsible alter column assigned_user_id type text using assigned_user_id::text');
  await expect(db.exec(repair)).rejects.toThrow('snapshot_schema_changed');
  await db.close();db=await setup();await db.exec(repair);
  await db.exec(`alter policy eia_select on employee_incident_actions using(is_tenant_operator_or_admin(tenant_id)
    or (is_tenant_member(tenant_id) and exists(select 1 from employees employee where employee.id=employee_incident_actions.employee_id
      and employee.tenant_id=employee_incident_actions.tenant_id and employee.user_id=(select auth.uid()))))`);
  await expect(db.exec(repair)).rejects.toThrow('mixed_policy_state');
 },30_000);
 it.each([false,true])('guarded standalone rollback restores exact old policy state; snapshot=%s',async snapshot=>{
  db=await setup(snapshot);const before=await graph(db);
  const policyQuery="select tablename,policyname,qual,with_check from pg_policies where schemaname='public' and tablename in('employees','incident_responsible','employee_incident_actions') order by tablename,policyname";
  const fullPoliciesBefore=(await db.query(policyQuery)).rows;await db.exec(repair);
  await db.exec(rollback);expect(await graph(db)).toEqual(before);
  expect((await db.query(policyQuery)).rows).toEqual(fullPoliciesBefore);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([]);
  expect(await visible(db,id.assigned,'employee_incident_actions')).toEqual([]);
  expect(await visible(db,id.assigned,'employees')).toEqual([]);
  await db.exec(rollback);await db.exec(repair);
  expect(await visible(db,id.assigned,'incident_responsible')).toEqual([id.responsible]);
 },30_000);
 it('rollback refuses RH policy drift and same-body dependency config drift',async()=>{
  db=await setup();await db.exec(repair);
  await db.exec('alter policy agvlog_select_authenticated on employees using(true)');
  const drifted=await graph(db);await expect(db.exec(rollback)).rejects.toThrow('protected_policy_changed');
  expect(await graph(db)).toEqual(drifted);
  await db.exec('alter policy agvlog_select_authenticated on employees using(is_tenant_operator_or_admin(tenant_id))');
  await db.exec("alter function auth.uid() set request.jwt.claim.sub='20000000-0000-4000-8000-000000000004'");
  const before=await graph(db);await expect(db.exec(rollback)).rejects.toThrow('authorization_metadata_or_acl_changed');
  expect(await graph(db)).toEqual(before);
 },30_000);
});
