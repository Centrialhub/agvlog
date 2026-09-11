// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import {createCoordinatedUnloadingCancellationDatabase,installCoordinatedCancellation,seedUnloadingRepairSource} from './helpers/coordinatedUnloadingCancellationDatabase';
import {installEffectiveCostReaderPredecessors,effectiveCostReadersSql,installEffectiveCostBuilder} from './helpers/effectiveCostReadersDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {recordedCostsSchema} from '@/lib/financial/recordedCostsContract';
import {recordedCostSummarySchema} from '@/lib/financial/recordedCostSummaryContract';
import {settlementExpenseContextSchema} from '@/lib/financial/settlementExpenseContextContract';
import {payablePortfolioSchema} from '@/lib/financial/payablePortfolioContract';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {expenseCostOriginSchema} from '@/lib/financial/unloadingCostCorrectionContract';
let db:Awaited<ReturnType<typeof createCoordinatedUnloadingCancellationDatabase>>;
beforeAll(async()=>{db=await createCoordinatedUnloadingCancellationDatabase();},30000);afterAll(async()=>db.close());
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>db.exec('rollback'));
async function setup(builder=false){const source=await seedUnloadingRepairSource(db,true);await installCoordinatedCancellation(db);await db.exec(readFileSync('supabase/migrations/20260911054915_finance_unloading_cancelled_claim_cost_resolution.sql','utf8'));await db.exec(readFileSync('supabase/migrations/20260911060519_finance_unloading_cost_amendments.sql','utf8'));if(builder)await installEffectiveCostBuilder(db);await installEffectiveCostReaderPredecessors(db);const signatures="select oid::regprocedure::text sig,prosrc,proacl,proconfig from pg_proc where oid in('finance_private.payable_portfolio_evidence(uuid,uuid)'::regprocedure,'finance_private.check_payable_payment_insert()'::regprocedure) order by sig";const protectedBefore=(await db.query(signatures)).rows;await db.exec(effectiveCostReadersSql());expect((await db.query(signatures)).rows).toEqual(protectedBefore);return source;}
async function change(charge:string){const ctx=(await db.query<{v:{expense_id:string,payable_id:string,revision:string,eligible:boolean}}>('select finance_private.unloading_cost_correction_context($1,$2,$3) v',[i.tenant,charge,'12000'])).rows[0].v;expect(ctx.eligible).toBe(true);await db.query('select finance_private.correct_unloading_cost($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),charge_id:charge,expense_id:ctx.expense_id,payable_id:ctx.payable_id,amount_cents:'12000',revision:ctx.revision,reason:'Correção do custo confirmado da descarga'}]);return ctx;}
it('uses one effective120 cost while preserving original150 in history, canonical metadata and the same payable',async()=>{
 const c=await setup();const ctx=await change(c.charge_id);
 const listing=(await db.query<{v:{total_cents:string,historical_total_cents:string,rows:Array<{amount_cents:number,effective_amount_cents:number,cost_origin:unknown}>}}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v;
 expenseHistorySchema.parse(listing);expect(listing).toMatchObject({total_cents:'12000',historical_total_cents:'15000'});expect(listing.rows[0].amount_cents).toBe(15000);expect(String(listing.rows[0].effective_amount_cents)).toBe('12000');expect(expenseCostOriginSchema.parse(listing.rows[0].cost_origin)).toMatchObject({verified:true,effective_amount_cents:'12000',original_amount_cents:'15000'});
 expect(recordedCostsSchema.parse((await db.query<{v:unknown}>('select finance_private.recorded_costs($1,$2) v',[i.tenant,{}])).rows[0].v)).toMatchObject({total_cents:'12000',total:1});
 expect(recordedCostSummarySchema.parse((await db.query<{v:unknown}>('select get_finance_recorded_cost_summary($1) v',[i.tenant])).rows[0].v)).toMatchObject({total_cents:'12000',totals_valid:true});
 const trip=(await db.query<{id:string}>('select b.trip_id id from finance_expense_batches b join finance_expense_items e on e.batch_id=b.id where e.id=$1',[ctx.expense_id])).rows[0].id;
 const canonical=(await db.query<{amount:string,metadata:unknown}>('select * from finance_private.canonical_trip_costs($1,$2)',[i.tenant,trip])).rows;expect(canonical).toHaveLength(1);expect(Number(canonical[0].amount)).toBe(120);expect(canonical[0].metadata).toMatchObject({reimbursable:false,settlement_credit_created:false,expense_cost_version:{amount_cents:'12000'}});
 expect((await db.query('select amount from payables where id=$1',[ctx.payable_id])).rows).toEqual([{amount:'120.00'}]);expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
});
it('changes the portfolio revision and freezes cost version in a real future payment event',async()=>{
 const c=await setup();const old=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_payable_portfolio($1,$2,$3,$4) v',[i.tenant,{},1,null])).rows[0].v;const ctx=await change(c.charge_id);
 const now=(await financeAs<{v:{revision:string,rows:Array<{expense_cost_version:unknown}>}}>(db,i.operator,'select get_finance_payable_portfolio($1,$2,$3,$4) v',[i.tenant,{},1,null])).rows[0].v;payablePortfolioSchema.parse(now);expect(now.revision).not.toBe(old.revision);expect(now.rows[0].expense_cost_version).toMatchObject({verified:true,amount_cents:'12000'});
 await db.query("update payables set status='approved' where tenant_id=$1 and id=$2",[i.tenant,ctx.payable_id]);
 const move=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:12000,occurred_on:'2026-08-04',description:'Pagamento da descarga corrigida',beneficiary_name:'Fornecedor preservado',reason:'Saída real para pagamento correto'}])).rows[0].v;
 await financeAs(db,i.operator,'select apply_finance_payable_movement($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),payable_id:ctx.payable_id,movement_id:move.movement_id,amount_cents:12000,method:'pix',reason:'Pagamento da obrigação corrigida'}]);
 expect((await db.query<{v:unknown}>("select after_data->'expense_cost_version' v from finance_events where action='payable_movement_applied'")).rows[0].v).toMatchObject({verified:true,amount_cents:'12000'});await db.exec('set constraints all immediate');const page=payablePortfolioSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_payable_portfolio($1,$2,$3,$4) v',[i.tenant,{},1,null])).rows[0].v);expect(page.rows[0].payment_cost_versions).toHaveLength(1);
});

it('does not silently fall back to the original or a partial total for an unverified owner-seeded version',async()=>{
 const c=await setup();const ctx=await change(c.charge_id);
 // Owner-only corruption fixture: a structurally valid journal link lacks its mandatory command/event.
 await db.query(`insert into finance_private.expense_cost_amendments(tenant_id,expense_id,charge_id,payable_id,ordinal,previous_id,request_id,revision_before,before_cents,after_cents,before_payable,after_payable,actor_id,actor_name,reason)
 select tenant_id,expense_id,charge_id,payable_id,ordinal+1,id,$2,(finance_private.expense_cost_effective(tenant_id,expense_id)->>'revision'),after_cents,11000,after_payable,after_payable||'{"amount":110}',actor_id,actor_name,'Evidência adversarial sem comando' from finance_private.expense_cost_amendments where expense_id=$1`,[ctx.expense_id,randomUUID()]);
 const listing=(await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v;expect(expenseHistorySchema.parse(listing)).toMatchObject({total_cents:null,complement_cents:null,cost_needs_review_count:1,rows:[{amount_cents:15000,effective_amount_cents:null,cost_origin:{verified:false}}]});
 expect(recordedCostsSchema.parse((await db.query<{v:unknown}>('select finance_private.recorded_costs($1,$2) v',[i.tenant,{}])).rows[0].v)).toMatchObject({total_cents:null,needs_review_count:1});
 expect(recordedCostSummarySchema.parse((await db.query<{v:unknown}>('select get_finance_recorded_cost_summary($1) v',[i.tenant])).rows[0].v)).toMatchObject({total_cents:null,totals_valid:false,invalid_count:1});
 const trip=(await db.query<{id:string}>('select b.trip_id id from finance_expense_batches b join finance_expense_items e on e.batch_id=b.id where e.id=$1',[ctx.expense_id])).rows[0].id;
 await db.exec('savepoint invalid_cost');await expect(db.query('select * from finance_private.canonical_trip_costs($1,$2)',[i.tenant,trip])).rejects.toMatchObject({code:'55000'});await db.exec('rollback to savepoint invalid_cost');
 expect((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_payable_portfolio($1,$2,$3,$4) v',[i.tenant,{},1,null])).rows[0].v).toMatchObject({totals_valid:false,invalid_titles:1});
});
it('keeps captured monetary evidence/payment guard byte-identical and rejects a mixed-driver reader',async()=>{
 const c=await setup();await change(c.charge_id);
 const privileges=(await db.query<{v:boolean}>("select has_function_privilege('authenticated','finance_private.expense_cost_version(uuid,uuid)','execute') v")).rows[0].v;expect(privileges).toBe(false);
 await db.query("insert into tenant_memberships values($1,$2,'driver',true)",[i.tenant,i.operator]);
 await expect(financeAs(db,i.operator,'select get_finance_recorded_cost_summary($1)',[i.tenant])).rejects.toMatchObject({code:'42501'});
});

it('builds and rebuilds the real settlement with effective cost120 and no additional driver credit',async()=>{
 const c=await setup(true);const ctx=await change(c.charge_id);const trip=(await db.query<{id:string}>('select b.trip_id id from finance_expense_batches b join finance_expense_items e on e.batch_id=b.id where e.id=$1',[ctx.expense_id])).rows[0].id;
 await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.driver,trip]);
 const settlement=(await db.query<{id:string}>('select public._build_driver_settlement($1,$2) id',[i.tenant,trip])).rows[0].id;
 const rows=()=>db.query<{amount:string,metadata:unknown}>("select amount,metadata from driver_settlement_items where settlement_id=$1 and source_table='finance_expense_items'",[settlement]);
 expect((await rows()).rows).toHaveLength(1);expect(Number((await rows()).rows[0].amount)).toBe(120);expect((await rows()).rows[0].metadata).toMatchObject({settlement_credit_created:false,reimbursable:false,expense_cost_version:{amount_cents:'12000'}});
 await db.query('select public._build_driver_settlement($1,$2)',[i.tenant,trip]);expect((await rows()).rows).toHaveLength(1);
 const view=(await db.query<{v:unknown}>('select get_finance_settlement_expense_context($1,$2) v',[i.tenant,settlement])).rows[0].v;settlementExpenseContextSchema.parse(view);expect(view).toMatchObject({total_cents:'12000',payable_cents:'12000',rows:[{amount_cents:'12000',cost_origin:{effective_amount_cents:'12000'}}]});
 expect((await db.query('select count(*)::int n from payables')).rows).toEqual([{n:1}]);expect((await db.query('select count(*)::int n from finance_movements')).rows).toEqual([{n:0}]);
});
it('includes an amended cost beyond page one in complete totals and server filters',async()=>{
 const c=await setup();await change(c.charge_id);
 await financeAs(db,i.operator,'select record_finance_expense_batch($1)',[{version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'office',description:'Custos posteriores para paginação real',reason:'Conferência de conjunto completo',items:Array.from({length:31},(_,n)=>({id:randomUUID(),category:'office',description:'Material posterior '+n,amount_cents:100,occurred_on:'2026-08-05',supplier_name:'Fornecedor de materiais',payee_type:'supplier',no_receipt_reason:'Comprovante sintético da fixture',allocations:[]}))}]);
 const first=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{page:1,page_size:30}])).rows[0].v);
 expect(first.rows).toHaveLength(30);expect(first.rows.every(r=>r.category==='office')).toBe(true);expect(first).toMatchObject({total:32,total_cents:'15100',historical_total_cents:'18100'});
 const second=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{page:2,page_size:30}])).rows[0].v);expect(second.rows.find(r=>r.unloading_id===c.charge_id)).toMatchObject({effective_amount_cents:'12000',amount_cents:15000});expect(second.total_cents).toBe(first.total_cents);
 const filtered=recordedCostsSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select list_finance_recorded_costs($1,$2) v',[i.tenant,{category:'unloading'}])).rows[0].v);expect(filtered).toMatchObject({total:1,total_cents:'12000'});
 const summary=recordedCostSummarySchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_recorded_cost_summary($1) v',[i.tenant])).rows[0].v);expect(summary).toMatchObject({total_count:32,total_cents:'15100',totals_valid:true});
});
it('reports an orphan canonical-cost pointer without breaking the whole portfolio',async()=>{
 await setup();const id=randomUUID();await db.query("insert into payables(id,tenant_id,supplier_name,category,description,amount,paid_amount,due_date,status,source_table,source_id) values($1,$2,'Fornecedor legado','office','Origem ausente',10,0,'2026-08-10','pending','finance_expense_items',$3)",[id,i.tenant,randomUUID()]);
 const p=payablePortfolioSchema.parse((await financeAs<{v:unknown}>(db,i.operator,'select get_finance_payable_portfolio($1,$2,$3,$4) v',[i.tenant,{},1,null])).rows[0].v);expect(p).toMatchObject({totals_valid:false,invalid_titles:1});expect(p.rows.find(r=>r.source_id===id)).toMatchObject({valid:false,expense_cost_version:null,payment_cost_versions:[],issues:expect.arrayContaining(['finance_cost_version_unverified'])});
});
