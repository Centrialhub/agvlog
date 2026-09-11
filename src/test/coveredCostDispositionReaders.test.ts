// @vitest-environment node
import {afterAll,afterEach,beforeAll,beforeEach,expect,it} from 'vitest';
import {readFileSync,writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {createUnloadingCostCorrectionDatabase,installUnloadingCostCorrection,seedUnloadingRepairSource} from './helpers/unloadingCostCorrectionDatabase';
import {installPreparedReceiptCostPredecessors} from './helpers/preparedReceiptCostIntegrationDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
import {installEffectiveCostBuilder} from './helpers/effectiveCostReadersDatabase';
import {recordedCostsSchema} from '@/lib/financial/recordedCostsContract';
import {recordedCostSummarySchema} from '@/lib/financial/recordedCostSummaryContract';
import {settlementExpenseContextSchema} from '@/lib/financial/settlementExpenseContextContract';
import {costDispositionsSchema} from '@/lib/financial/costDispositionsContract';
import {expenseCostCoverageSchema} from '@/lib/financial/expenseCostFundingContract';
import {payablePortfolioSchema} from '@/lib/financial/payablePortfolioContract';
let db:Awaited<ReturnType<typeof createUnloadingCostCorrectionDatabase>>;
const read=(name:string)=>readFileSync('supabase/migrations/'+name+'.sql','utf8');
beforeAll(async()=>{db=await createUnloadingCostCorrectionDatabase();},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});
afterEach(async()=>db.exec('rollback'));afterAll(async()=>db?.close());
const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Regularização econômica com reserva histórica preservada'});
async function rpc(name:string,payload:unknown){return(await financeAs<{v:Record<string,unknown>}>(db,i.operator,`select ${name}($1) v`,[payload])).rows[0].v;}
async function setup(){const source=await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);await installEffectiveCostBuilder(db);await installPreparedReceiptCostPredecessors(db);const baseline=read('20260824224152_baseline');const recalc=baseline.match(/CREATE OR REPLACE FUNCTION public\._recalc_payable_paid\(\)[\s\S]*?END \$function\$;/)![0].replace('FROM public.payables_payments WHERE','FROM finance_private.active_payable_payments WHERE');await db.exec(recalc);await db.exec('create trigger trg_recalc_payable_paid after insert or update or delete on public.payables_payments for each row execute function public._recalc_payable_paid()');return (await db.query<{expense:string,payable:string,charge:string}>('select id expense,payable_id payable,unloading_id charge from finance_expense_items where unloading_id=$1',[source.charge_id])).rows[0];}
async function install(){await db.exec(read('20260911072557_finance_unloading_covered_cost_regularization'));await db.exec(read('20260911072723_finance_effective_cost_disposition_readers'));}
async function regularize(e:{expense:string,payable:string|null,charge:string},amount='12000'){
 const funding=(await db.query<{v:{rows:Array<{source_kind:string,source_id:string,responsible_id:string,disposition_type:string}>}}>('select finance_private.expense_cost_funding($1,$2) v',[i.tenant,e.expense])).rows[0].v;
 const proposal={amount_cents:amount,dispositions:funding.rows.map(row=>({source_kind:row.source_kind,source_id:row.source_id,responsible_id:row.responsible_id,disposition_type:row.disposition_type,applied_cents:amount}))};
 const context=(await db.query<{v:{eligible:boolean,blockers:unknown[],revision:string}}>('select finance_private.unloading_cost_regularization_context($1,$2,$3) v',[i.tenant,e.charge,proposal])).rows[0].v;expect(context.blockers).toEqual([]);expect(context.eligible).toBe(true);
 await db.query('select finance_private.regularize_unloading_cost($1)',[{...base(),expense_id:e.expense,payable_id:e.payable,charge_id:e.charge,revision:context.revision,proposal}]);await db.exec('set constraints all immediate');await db.exec('set constraints all deferred');
}
it('preserves paid150, reserved150 and bank outflow150 while projecting cost120 and separate recovery30',async()=>{
 const e=await setup();await db.query("update payables set status='approved' where id=$1",[e.payable]);
 const m=await rpc('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:15000,occurred_on:'2026-08-02',description:'Pagamento já realizado',beneficiary_name:'Prestador diferente do devedor'});
 await rpc('apply_finance_payable_movement',{...base(),payable_id:e.payable,movement_id:m.movement_id,amount_cents:15000,method:'pix'});
 const snapshots=async()=>(await db.query('select to_jsonb(e) expense,to_jsonb(p) payable,to_jsonb(pp) payment,to_jsonb(l) link,to_jsonb(m) movement from finance_expense_items e join payables p on p.id=e.payable_id join payables_payments pp on pp.payable_id=p.id join finance_payable_movement_links l on l.payment_id=pp.id join finance_movements m on m.id=l.movement_id')).rows;
 const before=await snapshots();await install();await captureCatalog();await regularize(e);expect(await snapshots()).toEqual(before);
 const coverage=(await db.query<{v:unknown}>('select finance_private.expense_cost_coverage($1,$2) v',[i.tenant,e.expense])).rows[0].v;expenseCostCoverageSchema.parse(coverage);expect(coverage).toMatchObject({verified:true,gross_reserved_cents:'15000',applied_cents:'12000',residual_cents:'3000',payment_recovery_cents:'3000',complement_cents:'15000'});
 expect(recordedCostsSchema.parse((await db.query<{v:unknown}>('select finance_private.recorded_costs($1,$2) v',[i.tenant,{}])).rows[0].v).total_cents).toBe('12000');expect(recordedCostSummarySchema.parse((await db.query<{v:unknown}>('select get_finance_recorded_cost_summary($1) v',[i.tenant])).rows[0].v).total_cents).toBe('12000');
 const list=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v);expect(list).toMatchObject({total_cents:'12000',complement_cents:'15000',allocated_cents:'0'});
 const portfolio=payablePortfolioSchema.parse((await db.query<{v:unknown}>('select get_finance_payable_portfolio($1,$2,$3,$4) v',[i.tenant,{},1,null])).rows[0].v);expect(portfolio.rows.find(row=>row.source_id===e.payable)).toMatchObject({nominal_cents:'15000',paid_cents:'15000',open_cents:'0'});
 expect((await db.query('select finance_private.movement_used_cents($1,$2)::text n',[i.tenant,m.movement_id])).rows).toEqual([{n:'15000'}]);
 const pending=(await db.query<{v:unknown}>('select get_finance_cost_dispositions($1,$2,$3) v',[i.tenant,1,null])).rows[0].v;costDispositionsSchema.parse(pending);expect(pending).toMatchObject({total:1,needs_review_count:0,gross_reserved_cents:'15000',applied_cents:'12000',residual_cents:'3000'});
 const revision=(pending as {revision:string}).revision;
 await expect(financeAs(db,i.operator,'select get_finance_cost_dispositions($1,$2,$3)',[i.tenant,2,null])).rejects.toMatchObject({code:'22023'});
 expect((await financeAs<{v:{rows:unknown[]}}>(db,i.operator,'select get_finance_cost_dispositions($1,$2,$3) v',[i.tenant,2,revision])).rows[0].v.rows).toEqual([]);
 await db.exec('savepoint revision_change');await regularize(e,'10000');
 await expect(financeAs(db,i.operator,'select get_finance_cost_dispositions($1,$2,$3)',[i.tenant,2,revision])).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint revision_change');
 await expect(financeAs(db,i.operator,'select get_finance_cost_dispositions($1,$2,$3)',[i.otherTenant,1,null])).rejects.toMatchObject({code:'42501'});
 await db.exec('savepoint mixed_reader');await db.query("insert into tenant_memberships(tenant_id,user_id,role,active) values($1,$2,'driver',true)",[i.tenant,i.operator]);await expect(financeAs(db,i.operator,'select get_finance_cost_dispositions($1,$2,$3)',[i.tenant,1,null])).rejects.toMatchObject({code:'42501'});await db.exec('rollback to savepoint mixed_reader');
 expect((await db.query("select has_function_privilege('anon','public.get_finance_cost_dispositions(uuid,integer,text)','execute') allowed")).rows).toEqual([{allowed:false}]);
 await rpc('record_finance_expense_batch',{...base(),context:'office',description:'P�gina posterior preserva total global',items:Array.from({length:31},(_,n)=>({id:randomUUID(),category:'office',description:'Item posterior '+n,supplier_name:'Fornecedor de teste',amount_cents:100,occurred_on:'2026-08-03',no_receipt_reason:'Comprovante n�o dispon�vel nesta fixture',payee_type:'supplier',allocations:[]}))});
 const first=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{page:1,page_size:30}])).rows[0].v);
 const second=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{page:2,page_size:30}])).rows[0].v);
 expect(first.total_cents).toBe('15100');expect(first.rows.some(row=>row.id===e.expense)).toBe(false);expect(second.rows.some(row=>row.id===e.expense)).toBe(true);expect(second.total_cents).toBe(first.total_cents);
 await db.exec('savepoint corruption');
 // Owner-only corruption fixture: application writers cannot perform this update. No guard success is inferred.
 await db.exec('alter table finance_private.expense_cost_regularizations disable trigger user');await db.query("update finance_private.expense_cost_regularizations set source_snapshot=source_snapshot||jsonb_build_object('qa_broken_proof',true) where expense_id=$1",[e.expense]);await db.exec('alter table finance_private.expense_cost_regularizations enable trigger user');
 expect((await db.query<{v:unknown}>('select finance_private.expense_cost_coverage($1,$2) v',[i.tenant,e.expense])).rows[0].v).toMatchObject({verified:false,gross_reserved_cents:null,applied_cents:null});
 expect((await db.query<{v:unknown}>('select get_finance_cost_dispositions($1,$2,$3) v',[i.tenant,1,null])).rows[0].v).toMatchObject({total:1,needs_review_count:1,residual_cents:null});
 expect(expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v).total_cents).toBeNull();await db.exec('rollback to savepoint corruption');

},30000);

it('reports custody separately with zero uncovered cost and preserves original charge snapshot',async()=>{
 await seedUnloadingRepairSource(db,true);await installUnloadingCostCorrection(db);await installEffectiveCostBuilder(db);await installPreparedReceiptCostPredecessors(db);
 const src=(await db.query<{trip_id:string,supplier_id:string,receipt_path:string}>('select b.trip_id,e.supplier_id,e.receipt_path from finance_expense_items e join finance_expense_batches b on b.id=e.batch_id')).rows[0];
 await db.query('update dispatch_trips set driver_id=$1 where id=$2',[i.driver,src.trip_id]);
 const stop=randomUUID(),doc=randomUUID(),expense=randomUUID();await db.query("insert into dispatch_stops(id,tenant_id,dispatch_trip_id,stop_order,status,client_id,destination) values($1,$2,$3,2,'completed',$4,'Entrega financiada')",[stop,i.tenant,src.trip_id,src.supplier_id]);await db.query("insert into fiscal_documents(id,tenant_id,client_id,supplier_id,document_type,status) values($1,$2,$3,$3,'inbound','ready')",[doc,i.tenant,src.supplier_id]);await db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)',[i.tenant,stop,doc]);
 const delivery=(await financeAs<{v:{revision:string}}>(db,i.operator,'select get_finance_delivery_context($1,$2) v',[i.tenant,stop])).rows[0].v;
 const movement=await rpc('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'driver_advance',driver_id:i.driver,amount_cents:15000,occurred_on:'2026-08-02',description:'Envio ao motorista com responsabilidade',beneficiary_name:'Motorista na data do envio'});
 await rpc('record_finance_expense_batch',{...base(),context:'trip',trip_id:src.trip_id,description:'Descarga coberta pelo envio original',items:[{id:expense,category:'unloading',description:'Descarga integralmente coberta',amount_cents:15000,occurred_on:'2026-08-02',supplier_id:src.supplier_id,supplier_name:'Prestador conferido',payee_type:'supplier',receipt_path:src.receipt_path,allocations:[{movement_id:movement.movement_id,amount_cents:15000}],stop_id:stop,delivery_revision:delivery.revision}]});
 const e=(await db.query<{unloading_id:string,payable_id:string|null}>('select unloading_id,payable_id from finance_expense_items where id=$1',[expense])).rows[0];expect(e.payable_id).toBeNull();const original=(await db.query('select to_jsonb(a) v from finance_expense_allocations a where expense_id=$1',[expense])).rows;

 const chargeBefore=(await db.query('select source_snapshot from finance_unloading_charges where id=$1',[e.unloading_id])).rows;
 await install();await regularize({expense,payable:null,charge:e.unloading_id});
 expect((await db.query('select source_snapshot from finance_unloading_charges where id=$1',[e.unloading_id])).rows).toEqual(chargeBefore);
 const coverage=(await db.query<{v:unknown}>('select finance_private.expense_cost_coverage($1,$2) v',[i.tenant,expense])).rows[0].v;
 expenseCostCoverageSchema.parse(coverage);expect(coverage).toMatchObject({verified:true,allocation_reserved_cents:'15000',allocation_applied_cents:'12000',driver_custody_cents:'3000',complement_cents:'0',uncovered_cents:'0'});
 expect((await db.query('select to_jsonb(a) v from finance_expense_allocations a where expense_id=$1',[expense])).rows).toEqual(original);
 expect((await db.query('select finance_private.movement_used_cents($1,$2)::text n',[i.tenant,movement.movement_id])).rows).toEqual([{n:'15000'}]);
 const costs=(await db.query<{source_id:string,amount:string,metadata:unknown}>('select * from finance_private.canonical_trip_costs($1,$2)',[i.tenant,src.trip_id])).rows;
 expect(costs.find(x=>x.source_id===expense)).toMatchObject({amount:'120.0000000000000000',metadata:{reimbursable:false,settlement_credit_created:false,allocation_total_cents:15000}});
 const list=expenseHistorySchema.parse((await db.query<{v:unknown}>('select finance_private.list_expenses($1,$2) v',[i.tenant,{}])).rows[0].v);expect(list).toMatchObject({total_cents:'27000',allocated_cents:'15000',complement_cents:'15000'});
 const settlement=(await db.query<{id:string}>('select public._build_driver_settlement($1,$2) id',[i.tenant,src.trip_id])).rows[0].id;
 const context=settlementExpenseContextSchema.parse((await db.query<{v:unknown}>('select get_finance_settlement_expense_context($1,$2) v',[i.tenant,settlement])).rows[0].v);
 expect(context.rows.find(row=>row.id===expense)).toMatchObject({amount_cents:'12000',allocated_cents:'15000',payable_cents:'0',outstanding_cents:'0',needs_review:false});
 expect((await db.query<{amount:string,metadata:unknown}>("select amount,metadata from driver_settlement_items where settlement_id=$1 and source_table='finance_expense_items' and source_id=$2",[settlement,expense])).rows).toMatchObject([{amount:'120.0000000000000000',metadata:{reimbursable:false,settlement_credit_created:false,coverage:{driver_custody_cents:'3000'}}}]);

},30000);


async function captureCatalog(){const catalog=(await db.query(`select p.oid::regprocedure::text signature,md5(replace(p.prosrc,E'\\r\\n',E'\\n')) prosrc_md5,p.prosecdef,p.provolatile,p.proconfig,p.proacl::text acl from pg_proc p join pg_namespace n on n.oid=p.pronamespace where n.nspname='finance_private' and p.proname in('canonical_trip_costs','list_expenses','payable_effective_cost_evidence','payable_portfolio','settlement_expense_context','expense_cost_coverage','require_expense_cost_coverage','cost_dispositions') order by signature`)).rows;writeFileSync('docs/qa/finance-covered-cost-readers-catalog-2026-09-11.json',JSON.stringify(catalog,null,2)+'\n');}

