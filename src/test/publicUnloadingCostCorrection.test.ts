// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterAll,afterEach,it,expect} from 'vitest';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection,seedUnloadingRepairSource} from './helpers/unloadingCostCorrectionDatabase';
import {installEffectiveCostReaderPredecessors,effectiveCostReadersSql} from './helpers/effectiveCostReadersDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {unloadingCostCorrectionPreviewSchema,unloadingCostCorrectionResultSchema} from '@/lib/financial/unloadingCostCorrectionContract';
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
const publicSql=readFileSync('supabase/migrations/20260911062534_finance_unloading_cost_public_boundary.sql','utf8');
beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);afterAll(async()=>db.close());
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>db.exec('rollback'));
async function setup(promote=true){const c=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);if(promote){await installEffectiveCostReaderPredecessors(db);await db.exec(effectiveCostReadersSql());await db.exec(publicSql);}return c;}
async function preview(charge:string,amount='12000'){const value=(await financeAs<{v:unknown}>(db,i.operator,'select get_finance_unloading_cost_correction_context($1,$2,$3) v',[i.tenant,charge,amount])).rows[0].v;expect(value).not.toHaveProperty('_evidence');return unloadingCostCorrectionPreviewSchema.parse(value);}
function payload(p:Awaited<ReturnType<typeof preview>>){return{version:1,tenant_id:p.tenant_id,request_id:randomUUID(),charge_id:p.charge_id,expense_id:p.expense_id,payable_id:p.payable_id,amount_cents:p.target.amount_cents,revision:p.revision,reason:'Correção pública com revisão da aprovação'};}
async function command(p:ReturnType<typeof payload>){return unloadingCostCorrectionResultSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select correct_finance_unloading_cost($1) v',[p])).rows[0].v);}
it('public preview is sanitized and correction120 replays with an explicit new approval requirement',async()=>{
 const c=await setup();const initial=await preview(c.charge_id);await db.query("update payables set status='approved' where id=$1",[initial.payable_id]);const p=await preview(c.charge_id);expect(p).toMatchObject({can_execute:true,eligible:true,approval_reset:true,target:{payable_status:'pending'}});const request=payload(p);const result=await command(request);expect(await command(request)).toEqual(result);expect(result).toMatchObject({cost_after_cents:'12000',obligation_after_cents:'12000',approval_reset:true,payable_status:'pending',cash_changed:false,collection_changed:false});await db.exec('set constraints all immediate');expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
});
it('denies raw and anonymous execution, foreign company and mixed driver, including replay',async()=>{
 const c=await setup();const request=payload(await preview(c.charge_id));
 const acl=(await db.query<{anon:boolean,raw:boolean}>("select has_function_privilege('anon','public.correct_finance_unloading_cost(jsonb)','execute') anon,has_function_privilege('authenticated','finance_private.correct_unloading_cost(jsonb)','execute') raw")).rows[0];expect(acl).toEqual({anon:false,raw:false});
 await db.exec('savepoint anonymous_attempt');await db.exec('set local role anon');await expect(db.query('select public.correct_finance_unloading_cost($1)',[request])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint anonymous_attempt');
 await expect(financeAs(db,i.operator,'select finance_private.correct_unloading_cost($1)',[request])).rejects.toMatchObject({code:'42501'});
 await expect(command({...request,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
 await command(request);await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(command(request)).rejects.toMatchObject({code:'42501'});await expect(preview(c.charge_id)).rejects.toMatchObject({code:'42501'});
});
it('rejects promotion without effective readers and rolls back its wrapper creation',async()=>{
 await setup(false);await db.exec('savepoint incomplete_readers');await expect(db.exec(publicSql)).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint incomplete_readers');expect((await db.query("select to_regprocedure('public.correct_finance_unloading_cost(jsonb)') is null absent")).rows).toEqual([{absent:true}]);expect((await db.query('select count(*)::int n from finance_private.expense_cost_amendments')).rows).toEqual([{n:0}]);
});
it('invalidates a reviewed request on title change and exposes revoked invocation capacity',async()=>{
 const c=await setup();const p=await preview(c.charge_id);const request=payload(p);await db.query("update payables set notes='Informação administrativa posterior' where id=$1",[p.payable_id]);await expect(command(request)).rejects.toMatchObject({code:'40001'});
 await db.exec('revoke execute on function public.correct_finance_unloading_cost(jsonb) from authenticated');expect((await preview(c.charge_id)).can_execute).toBe(false);expect((await db.query('select count(*)::int n from finance_private.expense_cost_amendments')).rows).toEqual([{n:0}]);
});
