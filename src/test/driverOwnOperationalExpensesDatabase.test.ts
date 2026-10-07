// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {installExpenseMfaFixture} from './helpers/expenseMfaDatabase';
import {adjustmentPayload,installSettlementAdjustmentFixture} from './helpers/settlementAdjustmentDatabase';
import {creationCommand,creationContext,creationPayload,expenseCreationSql,installExpenseCreationFixture,manualSettlement} from './helpers/expenseCreationDatabase';
import {createExpenseReviewDatabase,expensePayload,seedExpense} from './helpers/expenseReviewDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';

// Disposable in-memory SQL graph, not a Supabase replica. Execute the complete
// forward with all eight predecessor/ACL/owner/policy guards intact. Auth claim
// settings and Storage metadata are fixture inputs; hosted JWT verification,
// upload gateway, actual Postgres concurrency and browser remain native gates.
const read=(path:string)=>readFileSync(path,'utf8').replace(/\r\n/g,'\n');
const migration=(name:string)=>read('supabase/migrations/'+name+'.sql');
const forward=migration('20261001191500_restore_driver_own_operational_expenses');
const release=read('supabase/rollouts/20260910230055_finance_internal_expense_adjustment_release.sql');
const functionSql=(sql:string,name:string)=>{
 const start=sql.indexOf('create or replace function '+name+'('),end=sql.indexOf('$function$;',start)+11;
 if(start<0||end<11)throw Error('Missing actual fixture dependency '+name);
 return sql.slice(start,end);
};
let db:PGlite,trip:string;
async function actor(user=i.user,claim:string|null=i.tenant,header:string|null=claim){
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false),set_config('request.headers',$3,false)",[
  user,JSON.stringify({role:'authenticated',aal:'aal1',...(claim?{active_tenant_id:claim}:{})}),JSON.stringify(header?{'x-agvlog-tenant-id':header}:{})]);
}
const apply=()=>db.exec(forward);
const count=async(table:string)=>(await db.query<{n:number}>('select count(*)::int n from '+table)).rows[0].n;
const rows=(table:string)=>operationRpc<{id:string}>(db,'select id from '+table+' order by id');
const receiptRows=(path:string)=>operationRpc<{name:string}>(db,'select name from storage.objects where name=$1',[path]);
const tableCatalog=()=>db.query("select tablename,policyname,permissive,roles,cmd,qual,with_check from pg_policies where schemaname in('public','storage') order by schemaname,tablename,policyname");
const functionCatalog=()=>db.query("select oid,pronamespace,proname,prosrc,proacl,proowner,proconfig,prosecdef,provolatile from pg_proc where pronamespace in('public'::regnamespace,'expense_creation_private'::regnamespace,'finance_private'::regnamespace) order by oid");
async function guardedExec(sql:string){
 await db.exec('savepoint driver_forward');
 try{await db.exec(sql);await db.exec('release savepoint driver_forward');}
 catch(error){await db.exec('rollback to savepoint driver_forward;release savepoint driver_forward');throw error;}
}
async function fixture(prepareLegacy?:(db:PGlite,trip:string)=>Promise<void>){
 const {db,trip}=await createExpenseReviewDatabase();
 await installExpenseCreationFixture(db);
 // Historical rows are constructed before the real immutable command guard is
 // installed. Never disable a trigger or grant a client mutation to seed them.
 if(prepareLegacy)await prepareLegacy(db,trip);
 await db.exec(expenseCreationSql());await installExpenseMfaFixture(db);
 await installSettlementAdjustmentFixture(db);
 const passwordPolicy=migration('20260831164442_remove_authenticator_requirement');
 for(const name of ['has_tenant_role','is_tenant_member','is_tenant_admin','is_tenant_operator_or_admin','is_user_internal_role'])await db.exec(functionSql(passwordPolicy,'public.'+name));
 // Retain the real baseline payment writer under the reconciled finance guard.
 // This is complementary coverage; native current-catalog payment stays a gate.
 const baseline=migration('20260824224152_baseline'),paymentStart=baseline.indexOf('CREATE OR REPLACE FUNCTION public.register_driver_settlement_payment_v2(');
 if(paymentStart<0)throw Error('Missing actual baseline payment writer');
 await db.exec(baseline.slice(paymentStart,baseline.indexOf('$function$;',paymentStart)+11));
 await db.exec('revoke all on function public.register_driver_settlement_payment_v2(uuid,numeric,text,text,text,text,text,boolean,text,uuid,text) from public,anon,service_role;grant execute on function public.register_driver_settlement_payment_v2(uuid,numeric,text,text,text,text,text,boolean,text,uuid,text) to authenticated;');
 const foundation=migration('20260909212104_finance_ledger_foundation');
 await db.exec(foundation.slice(0,foundation.indexOf('create table public.finance_movements')));
 await db.exec("create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$ select false; $$;");
 const receipts=migration('20260909220941_finance_receipt_evidence');
 await db.exec(receipts.slice(0,receipts.indexOf('create policy')));
 await db.transaction(async tx=>{await tx.exec(release);});
 await db.exec('create schema if not exists private; create table if not exists public.client_portal_access(user_id uuid,tenant_id uuid,active boolean);');
 const context=migration('20260910131125_active_tenant_auth_context');
 await db.exec(functionSql(context,'private.user_can_access_tenant'));
 await db.exec(migration('20260910140823_require_matching_active_tenant_claim'));
 await db.exec(functionSql(context,'private.is_request_tenant_member'));
 await db.query("select set_config('request.jwt.claim.sub',$1,false),set_config('request.jwt.claims',$2,false),set_config('request.headers',$3,false)",[i.user,JSON.stringify({role:'authenticated',aal:'aal1',active_tenant_id:i.tenant}),JSON.stringify({'x-agvlog-tenant-id':i.tenant})]);
 // Activate only this disposable catalog through the existing full fixture
 // checkpoint. The checked-in activation artifact and production stay intact.
 const catalog=(await db.query<{catalog_revision:string}>(read('docs/qa/finance-final-activation-catalog-checkpoint.sql'))).rows[0].catalog_revision;
 const activation=read('supabase/rollouts/20260911030716_finance_active_company_final_activation.sql');
 await db.transaction(async tx=>{await tx.exec(activation.replace('__FINAL_REVIEWED_CATALOG_REQUIRED__',catalog));});
 return {db,trip};
}
beforeAll(async()=>{({db,trip}=await fixture());},60000);
beforeEach(async()=>{await db.exec('begin');await actor();});
afterEach(async()=>{await db.exec('rollback;reset role');});
afterAll(()=>db?.close());

it('reproduces finance denial, then creates exactly one own operational expense and durable command',async()=>{
 await expect(creationContext(db,trip)).rejects.toMatchObject({code:'42501',message:'finance_access_denied'});
 await apply();
 const payload=await creationPayload(db,trip),result=await creationCommand(db,payload);
 expect(result).toMatchObject({confirmed:true,status:'pending',receipt_path:null});
 expect(await creationCommand(db,payload)).toEqual(result);
 expect((await db.query('select driver_id,amount::float amount,approval_status from driver_expenses')).rows).toEqual([{driver_id:i.driver,amount:25,approval_status:'pending'}]);
 expect(await count('driver_expense_creations')).toBe(1);
 for(const table of ['financial_obligations','bank_transactions','driver_settlement_payments'])expect(await count(table)).toBe(0);
 expect((await rows('driver_expenses')).rows).toEqual([{id:result.expense_id}]);
 expect((await rows('driver_expense_creations')).rows).toEqual([{id:result.command_id}]);
 await db.exec('set constraints all immediate');
});

it('preserves request payload equality, stale revision rejection and replay after a context change',async()=>{
 await apply();const payload=await creationPayload(db,trip),result=await creationCommand(db,payload);
 await expect(creationCommand(db,{...payload,fields:{...payload.fields,amount_cents:1}})).rejects.toThrow('key_mismatch');
 const next=await creationPayload(db,trip);await db.query('update dispatch_trips set notes=$1 where id=$2',['Context changed',trip]);
 await expect(creationCommand(db,next)).rejects.toThrow('context_changed');
 expect(await creationCommand(db,payload)).toEqual(result);expect(await count('driver_expenses')).toBe(1);
});

it('rejects a different actor, tenant, inactive driver and revoked membership, including replay',async()=>{
 await apply();const payload=await creationPayload(db,trip);await creationCommand(db,payload);
 await expect(creationCommand(db,{...payload,actor_id:i.operator})).rejects.toMatchObject({code:'42501'});
 await expect(creationCommand(db,{...payload,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
 await db.query('update drivers set active=false where id=$1',[i.driver]);await expect(creationCommand(db,payload)).rejects.toMatchObject({code:'42501'});
 await db.query('update drivers set active=true where id=$1',[i.driver]);await db.query('update tenant_memberships set active=false where user_id=$1',[i.user]);
 await expect(creationCommand(db,payload)).rejects.toMatchObject({code:'42501'});expect((await rows('driver_expenses')).rows).toEqual([]);
 expect(await count('driver_expenses')).toBe(1);
});

it('requires matching signed active-company and request-header context',async()=>{
 await apply();await actor(i.user,i.tenant,i.otherTenant);
 await expect(creationContext(db,trip)).rejects.toMatchObject({code:'42501',message:'tenant_context_claim_mismatch'});
 await actor(i.user,null,i.tenant);await expect(creationContext(db,trip)).rejects.toMatchObject({code:'42501',message:'tenant_context_claim_required'});
 await actor(i.user,i.otherTenant);await expect(creationContext(db,trip)).rejects.toMatchObject({code:'42501'});
 expect(await count('driver_expenses')).toBe(0);
});

it('keeps source ownership authoritative even for a valid driver identity',async()=>{
 await apply();await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.otherDriver,trip]);
 await expect(creationContext(db,trip)).rejects.toMatchObject({code:'42501'});
 expect(await count('driver_expenses')).toBe(0);
});

it('denies financial approval, settlement creation/replay and direct writes to driver and mixed identities',async()=>{
 await apply();const payload=await creationPayload(db,trip),created=await creationCommand(db,payload);
 const settlement=await manualSettlement(db);
 await actor(i.operator);await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.operator]);
 const approval=await expensePayload(db,created.expense_id),adjustment=await adjustmentPayload(db,settlement);
 await actor();
 for(const role of ['driver','admin']){
  await db.query('update tenant_memberships set role=$1 where tenant_id=$2 and user_id=$3',[role,i.tenant,i.user]);
  await expect(creationContext(db,settlement,'settlement')).rejects.toMatchObject({code:'42501'});
  await expect(creationCommand(db,{...payload,source_type:'settlement',source_id:settlement})).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,'select get_driver_expense_review_context($1,$2)',[i.tenant,created.expense_id])).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,'select review_driver_expense($1::jsonb)',[JSON.stringify({...approval,actor_id:i.user})])).rejects.toMatchObject({code:'42501',message:'finance_access_denied'});
  await expect(operationRpc(db,'select apply_driver_settlement_adjustment($1::jsonb)',[JSON.stringify({...adjustment,actor_id:i.user})])).rejects.toMatchObject({code:'42501',message:'finance_access_denied'});
  await expect(operationRpc(db,"select register_driver_settlement_payment_v2($1,25,'pix')",[settlement])).rejects.toMatchObject({code:'42501',message:'finance_access_denied'});
  await expect(operationRpc(db,"insert into driver_expenses(tenant_id,driver_id,category,amount) values($1,$2,'food',25)",[i.tenant,i.driver])).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,"update driver_expenses set notes='forbidden' where id=$1 returning id",[created.expense_id])).rejects.toMatchObject({code:'42501'});
  await expect(operationRpc(db,'delete from driver_expenses where id=$1 returning id',[created.expense_id])).rejects.toMatchObject({code:'42501'});
  expect(await creationCommand(db,payload)).toMatchObject({expense_id:created.expense_id});
 }
 expect(await count('driver_expenses')).toBe(1);expect(await count('financial_obligations')).toBe(0);expect(await count('driver_settlement_payments')).toBe(0);
 expect((await db.query('select approval_status from driver_expenses where id=$1',[created.expense_id])).rows).toEqual([{approval_status:'pending'}]);
});

it('permits existing internal operator settlement creation, without granting it to a later mixed identity',async()=>{
 await actor(i.operator);await apply();const settlement=await manualSettlement(db);
 const payload=await creationPayload(db,settlement,'settlement',i.operator),created=await creationCommand(db,payload);
 expect(await creationCommand(db,payload)).toEqual(created);
 await db.query('insert into drivers(id,tenant_id,user_id,active,name) values($1,$2,$3,true,$4)',[randomUUID(),i.tenant,i.operator,'Mixed QA']);
 await expect(creationCommand(db,payload)).rejects.toMatchObject({code:'42501'});
 expect(await count('driver_expenses')).toBe(1);
});

it('allows receipt upload recovery via RPC while unbound Storage reads stay denied, then reads the registered own receipt',async()=>{
 await apply();const payload=await creationPayload(db,trip);payload.receipt={sha256:'a'.repeat(64),mime:'image/png',size:8};payload.fields.no_receipt=false;payload.fields.no_receipt_reason='';
 const probe=(await operationRpc<{result:{path:string;metadata:Record<string,unknown>}}>(db,'select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[i.tenant,i.user,payload.request_id,'trip',trip,JSON.stringify(payload.receipt)])).rows[0].result;
 await expect(creationCommand(db,payload)).rejects.toThrow('not_uploaded');
 await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[probe.path,JSON.stringify(probe.metadata)]);
 expect((await receiptRows(probe.path)).rows).toEqual([]);
 expect((await operationRpc<{result:{uploaded:boolean}}>(db,'select get_expense_receipt_status($1,$2,$3,$4,$5::jsonb) result',[i.tenant,payload.request_id,'trip',trip,JSON.stringify(payload.receipt)])).rows[0].result.uploaded).toBe(true);
 const result=await creationCommand(db,payload);expect(result.receipt_path).toBe(probe.path);
 expect((await receiptRows(probe.path)).rows).toEqual([{name:probe.path}]);expect(await creationCommand(db,payload)).toEqual(result);
 await db.exec('set constraints all immediate');
});

it('denies wrong receipt metadata and rolls back a durable audit failure atomically',async()=>{
 await apply();const payload=await creationPayload(db,trip);payload.receipt={sha256:'b'.repeat(64),mime:'image/png',size:8};payload.fields.no_receipt=false;payload.fields.no_receipt_reason='';
 const probe=(await operationRpc<{result:{path:string;metadata:Record<string,unknown>}}>(db,'select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[i.tenant,i.user,payload.request_id,'trip',trip,JSON.stringify(payload.receipt)])).rows[0].result;
 await db.query("insert into storage.objects(bucket_id,name,user_metadata) values('receipts',$1,$2::jsonb)",[probe.path,JSON.stringify({...probe.metadata,actor_id:i.operator})]);
 await expect(creationCommand(db,payload)).rejects.toThrow('existing_object_mismatch');
 await db.query('update storage.objects set user_metadata=$1::jsonb where name=$2',[JSON.stringify(probe.metadata),probe.path]);
 await db.exec("create function qa_driver_creation_audit_failure() returns trigger language plpgsql as $$begin raise exception 'QA durable audit failure';end;$$;create trigger qa_driver_creation_audit_failure before insert on driver_expense_creations for each row execute function qa_driver_creation_audit_failure();");
 await expect(creationCommand(db,payload)).rejects.toThrow('QA durable audit failure');
 expect(await count('driver_expenses')).toBe(0);expect(await count('driver_expense_creations')).toBe(0);
 expect((await receiptRows(probe.path)).rows).toEqual([]);
});

it('reproduces uploader-directory and null-driver leaks of the unfinished predicates, then closes both with actual RLS',async()=>{
 const stableDb=db,stableTrip=trip,ownDriver=randomUUID();
 const path=(key:string)=>i.tenant+'/expense-receipts/'+i.operator+'/'+key+'/receipt.png';
 const foreignPath=path(randomUUID()),nullPath=path(randomUUID()),ownPath=path(randomUUID()),unboundPath=path(randomUUID());
 let foreign='',nullDriver='',own='';
 const isolated=await fixture(async(db,trip)=>{
  await db.query('insert into drivers(id,tenant_id,user_id,active,name) values($1,$2,null,true,$3)',[ownDriver,i.tenant,'Future mixed QA']);
  for(const p of [foreignPath,nullPath,ownPath,unboundPath])await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)",[p]);
  foreign=await seedExpense(db,trip,{receipt_url:foreignPath,no_receipt:false,no_receipt_reason:null});
  nullDriver=await seedExpense(db,trip,{driver_id:null,dispatch_trip_id:null,receipt_url:nullPath,no_receipt:false,no_receipt_reason:null});
  own=await seedExpense(db,trip,{driver_id:ownDriver,dispatch_trip_id:null,receipt_url:ownPath,no_receipt:false,no_receipt_reason:null});
 });
 db=isolated.db;trip=isolated.trip;
 try{
 await db.exec('begin');await actor(i.operator);await db.query("update tenant_memberships set role='admin' where user_id=$1",[i.operator]);
 await db.query('update drivers set user_id=$1 where id=$2',[i.operator,ownDriver]);
 // Only these two historical predicates are restored for reproduction in a
 // rollback-only savepoint. No unsafe forward is added to the release artifact.
 const secureReceipt="return expense_creation_private.owns_driver(t) and exists(\n  select 1 from public.driver_expenses e where e.tenant_id=t and e.receipt_url=_path\n   and e.driver_id is not null and expense_creation_private.owns_driver(t,e.driver_id));";
 const unsafeReceipt="return expense_creation_private.owns_driver(t) and\n (split_part(_path,'/',3)=auth.uid()::text or exists(select 1 from public.driver_expenses e\n  where e.tenant_id=t and e.receipt_url=_path and expense_creation_private.owns_driver(t,e.driver_id)));";
 if(!forward.includes(secureReceipt))throw Error('Regression fixture no longer matches reviewed receipt body');
 const unsafe=forward.replace(secureReceipt,unsafeReceipt).replace("own:='driver_id is not null and expense_creation_private.owns_driver(tenant_id,driver_id)'","own:='expense_creation_private.owns_driver(tenant_id,driver_id)'");
 await db.exec('savepoint unfinished_predicates');await db.exec(unsafe);
 expect((await rows('driver_expenses')).rows.map(r=>r.id)).toContain(nullDriver);
 expect((await receiptRows(foreignPath)).rows).toEqual([{name:foreignPath}]);
 expect((await receiptRows(unboundPath)).rows).toEqual([{name:unboundPath}]);
 await db.exec('rollback to savepoint unfinished_predicates;release savepoint unfinished_predicates');await apply();
 expect((await rows('driver_expenses')).rows).toEqual([{id:own}]);
 for(const p of [foreignPath,nullPath,unboundPath])expect((await receiptRows(p)).rows).toEqual([]);
 expect((await receiptRows(ownPath)).rows).toEqual([{name:ownPath}]);
 await actor();expect((await receiptRows(foreignPath)).rows).toEqual([{name:foreignPath}]);
 expect((await rows('driver_expenses')).rows).toEqual([{id:foreign}]);
 }finally{await db.exec('rollback');await db.close();db=stableDb;trip=stableTrip;}
});

it('preserves wrapper OIDs, ACLs and global finance/authorization bodies',async()=>{
 const signatures=['public.create_driver_expense_command(jsonb)','public.get_expense_creation_context(uuid,text,uuid)','finance_private.can_access(uuid)','finance_private.not_driver(uuid)','public.is_tenant_operator_or_admin(uuid)','public.get_driver_expense_review_context(uuid,uuid)'];
 const sql="select oid,prosrc,proacl,proowner,proconfig,prosecdef,provolatile from pg_proc where oid=any($1::regprocedure[]) order by oid";
 const before=(await db.query(sql,[signatures])).rows;await apply();expect((await db.query(sql,[signatures])).rows).toEqual(before);
 await expect(guardedExec(forward)).rejects.toThrow('already_applied');
});

it('rejects predecessor drift and rolls back the complete forward without catalog changes',async()=>{
 await db.exec('alter function expense_creation_private.get_expense_receipt_status(uuid,uuid,text,uuid,jsonb) volatile');
 const beforeFunctions=(await functionCatalog()).rows,beforePolicies=(await tableCatalog()).rows;
 await expect(guardedExec(forward)).rejects.toThrow('driver_own_expense_contract_changed');
 expect((await functionCatalog()).rows).toEqual(beforeFunctions);expect((await tableCatalog()).rows).toEqual(beforePolicies);
 expect((await db.query<{absent:boolean}>("select to_regprocedure('expense_creation_private.owns_driver(uuid,uuid)') is null absent")).rows[0].absent).toBe(true);
});
