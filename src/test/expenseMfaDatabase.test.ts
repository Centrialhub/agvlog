// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {expenseMfaDatabase,expenseMfaActor,expenseMfaRole} from './helpers/expenseMfaDatabase';
import {manualSettlement,creationContext,creationPayload,creationCommand} from './helpers/expenseCreationDatabase';
import {expenseContext,expenseCommand,expensePayload} from './helpers/expenseReviewDatabase';
import {expenseCreationRelease} from './helpers/expenseCreationRelease';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
let db:PGlite,trip:string;
const receipt={sha256:'a'.repeat(64),mime:'image/png',size:8};
beforeAll(async()=>{({db,trip}=await expenseMfaDatabase());},30000);
afterAll(async()=>{await db?.close();});
beforeEach(async()=>{await db.exec('begin');await expenseMfaActor(db);});
afterEach(async()=>{await db.exec('rollback');});
const deny={code:'42501',message:'expense_creation_mfa_required'};
const snapshot=async()=>Object.fromEntries(await Promise.all(['loads','dispatch_trips','dispatch_stops','driver_expenses','driver_expense_creations','driver_settlements','driver_settlement_items','driver_settlement_payments','financial_obligations'].map(async table=>[table,(await db.query<{value:unknown}>('select coalesce(jsonb_agg(to_jsonb(r) order by id),\'[]\') value from '+table+' r')).rows[0].value])));
const probe=(source:string,actor=i.operator)=>operationRpc(db,'select inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb) result',[i.tenant,actor,randomUUID(),'settlement',source,JSON.stringify(receipt)]);
describe('expense MFA forward correction',{timeout:15000},()=>{
 it.each(['owner','admin'])('denies every %s creation entry point with no MFA',async(role)=>{
  await expenseMfaRole(db,role);await expenseMfaActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  const payload=await creationPayload(db,source,'settlement',i.operator),before=await snapshot();await expenseMfaActor(db);
  await expect(creationContext(db,source,'settlement')).rejects.toMatchObject(deny);
  await expect(creationCommand(db,payload)).rejects.toMatchObject(deny);
  await expect(probe(source)).rejects.toMatchObject(deny);
  await expect(operationRpc(db,'select get_expense_receipt_status($1,$2,$3,$4,$5::jsonb)',[i.tenant,payload.request_id,'settlement',source,JSON.stringify(receipt)])).rejects.toMatchObject(deny);
  await expect(operationRpc(db,'select recalculate_manual_expense_settlement($1,$2)',[i.tenant,source])).rejects.toMatchObject(deny);
  expect(await snapshot()).toEqual(before);
 });
 it.each([null,'aal1','aal3'])('denies missing/invalid assurance %s and ignores user-editable metadata',async(aal)=>{
  await expenseMfaRole(db,'admin');await expenseMfaActor(db,i.operator,aal,{user_metadata:{aal:'aal2',role:'owner'},app_metadata:{aal:'aal2'}});
  await expect(creationContext(db,await manualSettlement(db),'settlement')).rejects.toMatchObject(deny);
 });
 it.each(['owner','admin'])('preserves %s AAL2 create, review and manual totals without payment',async(role)=>{
  await expenseMfaRole(db,role);await expenseMfaActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  const result=await creationCommand(db,await creationPayload(db,source,'settlement',i.operator));expect(result.confirmed).toBe(true);
  expect((await expenseContext(db,result.expense_id)).can_approve).toBe(true);await expenseCommand(db,await expensePayload(db,result.expense_id));
  await operationRpc(db,'select recalculate_manual_expense_settlement($1,$2)',[i.tenant,source]);
  expect((await db.query('select (approved_expenses_total*100)::int approved_cents,(driver_payable_amount*100)::int payable_cents,(total_paid_amount*100)::int paid_cents from driver_settlements where id=$1',[source])).rows[0]).toEqual({approved_cents:2500,payable_cents:2500,paid_cents:0});
 });
 it('preserves AAL1 operator creation but not administrative approval',async()=>{
  await expenseMfaRole(db,'operator');const source=await manualSettlement(db),result=await creationCommand(db,await creationPayload(db,source,'settlement',i.operator));
  expect(result.confirmed).toBe(true);expect((await expenseContext(db,result.expense_id)).can_approve).toBe(false);
 });
 it('preserves AAL1 driver creation, list and source discovery',async()=>{
  await expenseMfaActor(db,i.user);const result=await creationCommand(db,await creationPayload(db,trip));
  expect(result.confirmed).toBe(true);
  for(const name of ['list_driver_expenses','list_driver_expense_sources'])expect((await operationRpc(db,'select '+name+'($1,0) result',[i.tenant])).rows[0].result).toMatchObject({total:1});
 });
 it('requires current MFA even for exact replay, preserving the original confirmation',async()=>{
  await expenseMfaRole(db,'admin');await expenseMfaActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  const payload=await creationPayload(db,source,'settlement',i.operator),result=await creationCommand(db,payload);
  await expenseMfaActor(db);await expect(creationCommand(db,payload)).rejects.toMatchObject(deny);
  expect((await operationRpc(db,'select count(*)::int n from driver_expense_creations')).rows[0].n).toBe(0);
  await expenseMfaActor(db,i.operator,'aal2');expect(await creationCommand(db,payload)).toEqual(result);
  expect((await db.query<{n:number}>('select count(*)::int n from driver_expenses')).rows[0].n).toBe(1);
 });
 it('denies profile-based list and direct reads when the driver is promoted to admin at AAL1',async()=>{
  await expenseMfaActor(db,i.user);await creationCommand(db,await creationPayload(db,trip));
  await expenseMfaRole(db,'admin',i.user);
  for(const name of ['list_driver_expenses','list_driver_expense_sources'])await expect(operationRpc(db,'select '+name+'($1,0)',[i.tenant])).rejects.toMatchObject(deny);
  expect((await operationRpc(db,'select count(*)::int n from driver_expenses')).rows[0].n).toBe(0);
  expect((await operationRpc(db,'select count(*)::int n from driver_expense_creations')).rows[0].n).toBe(0);
 });
 it('protects receipt objects from owner-path reads without MFA',async()=>{
  const path=i.tenant+'/expense-receipts/'+i.operator+'/'+randomUUID()+'/receipt.png';
  await db.query("insert into storage.objects(id,bucket_id,name) values($1,'receipts',$2)",[randomUUID(),path]);
  await expenseMfaRole(db,'admin');
  expect((await operationRpc(db,'select count(*)::int n from storage.objects')).rows[0].n).toBe(0);
  await expenseMfaActor(db,i.operator,'aal2');expect((await operationRpc(db,'select count(*)::int n from storage.objects')).rows[0].n).toBe(1);
 });
 it('authorizes receipt inspection only with the current matching user JWT',async()=>{
  const source=await manualSettlement(db);
  expect((await probe(source)).rows[0].result).toMatchObject({uploaded:false,actor_id:i.operator});
  await expect(probe(source,i.user)).rejects.toMatchObject({code:'42501',message:'expense_creation_not_authorized'});
  await db.exec('savepoint probe_role;set role service_role');
  await expect(db.query('select public.inspect_expense_receipt_upload($1,$2,$3,$4,$5,$6::jsonb)',[i.tenant,i.operator,randomUUID(),'settlement',source,JSON.stringify(receipt)])).rejects.toMatchObject({code:'42501'});
  await db.exec('rollback to savepoint probe_role;release savepoint probe_role');
 });
 it('denies direct private calls too and exposes only invoker wrappers',async()=>{
  await expenseMfaRole(db,'admin');const source=await manualSettlement(db);
  await expect(operationRpc(db,'select expense_creation_private.get_expense_creation_context($1,$2,$3)',[i.tenant,'settlement',source])).rejects.toMatchObject(deny);
  const rows=(await db.query("select p.proname,p.prosecdef,has_function_privilege('anon',p.oid,'execute') anon,has_function_privilege('service_role',p.oid,'execute') service from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='public' and p.proname in('get_expense_creation_context','get_expense_receipt_status','inspect_expense_receipt_upload','create_driver_expense_command','list_driver_expenses','list_driver_expense_sources','recalculate_manual_expense_settlement')")).rows;
  expect(rows).toHaveLength(7);for(const row of rows)expect(row).toMatchObject({prosecdef:false,anon:false,service:false});
 });
 it('does not allow earlier release scripts to restore a pre-MFA endpoint',async()=>{
  for(const mode of ['contain','resume'] as const)await expect(expenseCreationRelease(db,mode)).rejects.toThrow(/function or grants changed/);
  await expenseMfaRole(db,'admin');await expect(creationContext(db,await manualSettlement(db),'settlement')).rejects.toMatchObject(deny);
 });
 it('denies revoked membership and another tenant regardless of AAL2',async()=>{
  await expenseMfaRole(db,'admin');await expenseMfaActor(db,i.operator,'aal2');const source=await manualSettlement(db);
  await expect(operationRpc(db,'select get_expense_creation_context($1,$2,$3)',[i.otherTenant,'settlement',source])).rejects.toMatchObject({code:'42501'});
  await db.query('update tenant_memberships set active=false where tenant_id=$1 and user_id=$2',[i.tenant,i.operator]);await expect(creationContext(db,source,'settlement')).rejects.toMatchObject({code:'42501'});
 });
});
