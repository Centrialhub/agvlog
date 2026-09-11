// @vitest-environment node
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { afterAll, afterEach, beforeAll, beforeEach, expect, it } from 'vitest';
import { createUnloadingCostCorrectionDatabase, installUnloadingCostCorrection, seedUnloadingRepairSource } from './helpers/unloadingCostCorrectionDatabase';
import { installPreparedReceiptCostPredecessors } from './helpers/preparedReceiptCostIntegrationDatabase';
import { financeIds as i, financeAs } from './helpers/financeLedgerDatabase';
let db: Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
const migration = (name: string) => readFileSync(`supabase/migrations/${name}.sql`, 'utf8');
beforeAll(async () => { db = await createUnloadingCostCorrectionDatabase(); }, 30000);
beforeEach(async () => {
 await db.exec('begin');
 await db.query("select set_config('request.jwt.claim.sub',$1,true)", [i.operator]);
 await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2", [i.tenant,i.operator]);
});
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });
const base = () => ({ version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência documentada da regularização' });
async function call<T>(name:string, payload:unknown) {
 return (await financeAs<{v:T}>(db,i.operator,`select ${name}($1) v`,[payload])).rows[0].v;
}
async function setup() {
 const source=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);
 const baseline=migration('20260824224152_baseline');
 const recalc=baseline.match(/CREATE OR REPLACE FUNCTION public\._recalc_payable_paid\(\)[\s\S]*?\$function\$;/)?.[0];
 if(!recalc)throw Error('Missing baseline payment recalculation');
 await db.exec(recalc.replace('FROM public.payables_payments WHERE','FROM finance_private.active_payable_payments WHERE'));
 await db.exec('create trigger trg_recalc_payable_paid after insert or delete or update on payables_payments for each row execute function public._recalc_payable_paid()');
 const expense=(await db.query<{id:string,payable_id:string,supplier_id:string,supplier_name:string}>('select id,payable_id,supplier_id,supplier_name from finance_expense_items where unloading_id=$1',[source.charge_id])).rows[0];
 await db.query("update payables set status='approved' where id=$1",[expense.payable_id]);
 const movement=await call<{movement_id:string}>('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:15000,occurred_on:'2026-08-02',description:'Pagamento original conferido',beneficiary_name:expense.supplier_name});
 const payment=await call<{link_id:string}>('apply_finance_payable_movement',{...base(),payable_id:expense.payable_id,movement_id:movement.movement_id,amount_cents:15000,method:'pix'});
 await installPreparedReceiptCostPredecessors(db);
 await db.exec(migration('20260911072557_finance_unloading_covered_cost_regularization'));
 await db.exec(migration('20260911072723_finance_effective_cost_disposition_readers'));
 const specs=[...JSON.parse(readFileSync('docs/qa/finance-covered-cost-core-catalog-2026-09-11.json','utf8')),...JSON.parse(readFileSync('docs/qa/finance-covered-cost-readers-catalog-2026-09-11.json','utf8'))];
 const catalog=(await db.query("select p.oid::regprocedure::text signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) prosrc_md5,p.prosecdef,p.proconfig,p.proacl::text acl from pg_proc p where p.oid=any(select to_regprocedure(x) from unnest($1::text[])x) order by 1",[specs.map((item:{signature:string})=>item.signature)])).rows;
 writeFileSync('docs/qa/finance-covered-cost-public-dependencies-2026-09-11.json',JSON.stringify(catalog,null,2)+'\n');
 await db.exec(migration('20260911074203_finance_unloading_cost_regularization_public_boundary'));
 return {...source,...expense,...movement,...payment};
}
async function preview(charge:string, proposal:unknown) {
 return (await financeAs<{v:{revision:string,eligible:boolean,can_execute:boolean,actor_id:string,tenant_id:string,_evidence?:unknown}}>(db,i.operator,'select preview_finance_unloading_cost_regularization($1,$2,$3) v',[i.tenant,charge,proposal])).rows[0].v;
}
it('exposes an authorized preview without raw evidence and records/replays through the public command',async()=>{
 const s=await setup();const proposal={amount_cents:'12000',dispositions:[{source_kind:'payable_link',source_id:s.link_id,applied_cents:'12000',disposition_type:'payment_recovery',responsible_id:s.supplier_id}]};
 const reviewed=await preview(s.charge_id,proposal);
 expect(reviewed).toMatchObject({eligible:true,can_execute:true,tenant_id:i.tenant,actor_id:i.operator});expect(reviewed).not.toHaveProperty('_evidence');
 const payload={...base(),charge_id:s.charge_id,expense_id:s.id,payable_id:s.payable_id,proposal,revision:reviewed.revision};
 const result=await call('regularize_finance_unloading_cost',payload);expect(await call('regularize_finance_unloading_cost',payload)).toEqual(result);
 await db.exec('set constraints all immediate');
 expect(result).toMatchObject({confirmed:true,effects:{cash_changed:false,payable_changed:false,residual_cents:'3000',movement_capacity_released_cents:'0'}});
 await db.query("update tenant_memberships set active=false where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);
 await expect(call('regularize_finance_unloading_cost',payload)).rejects.toMatchObject({code:'42501'});
});
it('keeps raw writers private and denies anonymous and cross-company entry points',async()=>{
 const s=await setup();
 const permissions=(await db.query<{v:Record<string,boolean>}>("select jsonb_build_object('public_actor',has_function_privilege('authenticated','public.regularize_finance_unloading_cost(jsonb)','execute'),'public_anon',has_function_privilege('anon','public.regularize_finance_unloading_cost(jsonb)','execute'),'raw_actor',has_function_privilege('authenticated','finance_private.regularize_unloading_cost(jsonb)','execute'),'raw_service',has_function_privilege('service_role','finance_private.regularize_unloading_cost(jsonb)','execute')) v")).rows[0].v;
 expect(permissions).toEqual({public_actor:true,public_anon:false,raw_actor:false,raw_service:false});
 await expect(financeAs(db,i.driverUser,'select preview_finance_unloading_cost_regularization($1,$2,$3)',[i.tenant,s.charge_id,{amount_cents:'12000',dispositions:[]}])).rejects.toMatchObject({code:'42501'});
 await expect(financeAs(db,i.operator,'select preview_finance_unloading_cost_regularization($1,$2,$3)',[i.otherTenant,s.charge_id,{amount_cents:'12000',dispositions:[]}])).rejects.toMatchObject({code:'42501'});
});

it('preserves the existing unfunded cost correction after installing the covered-cost release',async()=>{
 const source=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);await installPreparedReceiptCostPredecessors(db);
 await db.exec(migration('20260911072557_finance_unloading_covered_cost_regularization'));
 await db.exec(migration('20260911072723_finance_effective_cost_disposition_readers'));
 await db.exec(migration('20260911074203_finance_unloading_cost_regularization_public_boundary'));
 const expense=(await db.query<{id:string,payable_id:string}>('select id,payable_id from finance_expense_items where unloading_id=$1',[source.charge_id])).rows[0];
 const context=(await financeAs<{v:{revision:string,eligible:boolean,can_execute:boolean}}>(db,i.operator,'select get_finance_unloading_cost_correction_context($1,$2,$3) v',[i.tenant,source.charge_id,'12000'])).rows[0].v;
 expect(context).toMatchObject({eligible:true,can_execute:true});
 await call('correct_finance_unloading_cost',{...base(),charge_id:source.charge_id,expense_id:expense.id,payable_id:expense.payable_id,revision:context.revision,amount_cents:'12000'});
 await db.exec('set constraints all immediate');
 expect((await db.query<{v:unknown}>('select finance_private.expense_cost_effective($1,$2) v',[i.tenant,expense.id])).rows[0].v).toMatchObject({verified:true,effective_amount_cents:'12000',regularization:null});
 expect((await db.query('select count(*)::int n from finance_private.expense_cost_regularizations')).rows).toEqual([{n:0}]);
});
