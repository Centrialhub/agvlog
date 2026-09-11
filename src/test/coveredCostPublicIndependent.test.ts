// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection,seedUnloadingRepairSource} from './helpers/unloadingCostCorrectionDatabase';
import {installPreparedReceiptCostPredecessors} from './helpers/preparedReceiptCostIntegrationDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {costDispositionsSchema} from '@/lib/financial/costDispositionsContract';
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>db.exec('rollback'));afterAll(async()=>db?.close());
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Regularização econômica com reserva histórica preservada'});
async function rpc(name:string,payload:unknown){return(await financeAs<{v:Record<string,unknown>}>(db,i.operator,`select ${name}($1) v`,[payload])).rows[0].v;}
async function setup(){const source=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);await installPreparedReceiptCostPredecessors(db);const baseline=read('20260824224152_baseline');const recalc=baseline.match(/CREATE OR REPLACE FUNCTION public\._recalc_payable_paid\(\)[\s\S]*?END \$function\$;/)![0].replace('FROM public.payables_payments WHERE','FROM finance_private.active_payable_payments WHERE');await db.exec(recalc);await db.exec('create trigger trg_recalc_payable_paid after insert or update or delete on public.payables_payments for each row execute function public._recalc_payable_paid()');return (await db.query<{expense:string,payable:string,charge:string}>('select id expense,payable_id payable,unloading_id charge from finance_expense_items where unloading_id=$1',[source.charge_id])).rows[0];}
async function install(){await db.exec(read('20260911072557_finance_unloading_covered_cost_regularization'));await db.exec(read('20260911072723_finance_effective_cost_disposition_readers'));}

import {unloadingCostRegularizationPreviewSchema,parseUnloadingCostRegularizationResult} from '@/lib/financial/unloadingCostRegularizationContract';
const boundary=()=>db.exec(read('20260911074203_finance_unloading_cost_regularization_public_boundary'));
async function paid(){const e=await setup();await db.query("update payables set status='approved' where id=$1",[e.payable]);const supplier=(await db.query<{id:string,name:string}>('select supplier_id id,supplier_name name from finance_expense_items where id=$1',[e.expense])).rows[0];const m=await rpc('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:15000,occurred_on:'2026-08-02',description:'Pagamento preservado',beneficiary_name:supplier.name});const link=await rpc('apply_finance_payable_movement',{...base(),payable_id:e.payable,movement_id:m.movement_id,amount_cents:15000,method:'pix'});await install();return{e,proposal:{amount_cents:'12000',dispositions:[{source_kind:'payable_link' as const,source_id:link.link_id as string,responsible_id:supplier.id,disposition_type:'payment_recovery' as const,applied_cents:'12000'}]}};}
it('promotes only reviewed readers and parses authenticated public preview/result/replay with pending recovery',async()=>{
 const {e,proposal}=await paid();await boundary();const preview=unloadingCostRegularizationPreviewSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select preview_finance_unloading_cost_regularization($1,$2,$3) v',[i.tenant,e.charge,proposal])).rows[0].v);expect(preview.can_execute).toBe(true);expect(preview).not.toHaveProperty('_evidence');
 const command={...base(),version:1 as const,expense_id:e.expense,payable_id:e.payable,charge_id:e.charge,revision:preview.revision,proposal};const result=parseUnloadingCostRegularizationResult(await rpc('regularize_finance_unloading_cost',command),command,i.operator,preview.effects);expect(await rpc('regularize_finance_unloading_cost',command)).toEqual(result);await db.exec('set constraints all immediate');
 const pending=costDispositionsSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_cost_dispositions($1,$2,$3) v',[i.tenant,1,null])).rows[0].v);expect(pending.residual_cents).toBe('3000');
 await expect(rpc('finance_private.regularize_unloading_cost',command)).rejects.toMatchObject({code:'42501'});await expect(rpc('regularize_finance_unloading_cost',{...command,tenant_id:i.otherTenant})).rejects.toMatchObject({code:'42501'});
 await db.query("update tenant_memberships set active=false where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);await expect(rpc('regularize_finance_unloading_cost',command)).rejects.toMatchObject({code:'42501'});
},30000);
it('rejects promotion after reviewed coverage ACL drift with no public writer residue',async()=>{
 await paid();await db.exec('savepoint drift');await db.exec('grant execute on function finance_private.expense_cost_coverage(uuid,uuid) to authenticated');await expect(boundary()).rejects.toThrow('finance_regularization_dependency_changed');await db.exec('rollback to savepoint drift');
 expect((await db.query("select to_regprocedure('public.regularize_finance_unloading_cost(jsonb)') is null absent")).rows).toEqual([{absent:true}]);await boundary();expect((await db.query("select has_function_privilege('anon','public.regularize_finance_unloading_cost(jsonb)','execute') allowed")).rows).toEqual([{allowed:false}]);
},30000);
