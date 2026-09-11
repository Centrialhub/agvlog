import assert from 'node:assert/strict';
import {recordedCostSummarySchema} from '../src/lib/financial/recordedCostSummaryContract.ts';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';

// A narrow synthetic dependency fixture; all commands and capacity triggers are
// installed from the actual candidate SQL. Never uses a configured remote DB.
export async function runRecordedCostSummaryNative({query,contested,literal:q,createRoles=false}){
 const database='finance_recorded_cost_qa';await query(`create database ${database}`);
 const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`create schema storage;create table storage.objects(id uuid primary key,name text,bucket_id text,metadata jsonb);alter table drivers add column name text default 'Motorista QA';
 create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);
 create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);`);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await run(type[0]);
 for(const table of ['clients','cost_centers','dispatch_trips','dispatch_stops','fiscal_documents','dispatch_stop_documents','receivables','payables','bank_transactions','payroll_periods','employees','payroll_entries','payroll_entry_items','payables_payments','driver_settlements','driver_settlement_payments','receivables_payments','closing_report_payments','load_payments','employee_advances']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);await run(`alter table ${table} add primary key(id)`);
 }
 await run('create function public.is_tenant_admin(uuid) returns boolean language sql as $$select true$$;');
 for(const name of ['_recalc_payable_paid','reverse_payable_payment','close_payroll_period','register_payable_payment','create_manual_expense']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
  if(!body)throw new Error(`Missing ${name}`);await run(body);
 }
 await run('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();grant execute on function reverse_payable_payment(uuid) to authenticated;');
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260909220020_finance_expense_workspace_queries.sql','20260909233625_finance_audit_queries.sql','20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await run(readFileSync(`supabase/migrations/${file}`,'utf8'));


 const target='20260910130540_finance_settlement_movement_links.sql',settlementSql=readFileSync('supabase/migrations/'+target,'utf8');
 await run('begin;'+settlementSql+'commit;');console.log('Settlement candidate '+target+' SHA256 '+createHash('sha256').update(settlementSql).digest('hex'));
 for(const file of ['20260910130921_finance_settlement_movement_options.sql','20260910131149_finance_settlement_link_audit.sql','20260910132411_finance_settlement_link_reversals.sql']){
  const candidate=readFileSync('supabase/migrations/'+file,'utf8');await run('begin;'+candidate+'commit;');
  console.log('Settlement candidate '+file+' SHA256 '+createHash('sha256').update(candidate).digest('hex'));
 }
 await run(`alter table closing_report_payments add column canonical_receivable_payment_id uuid;
 alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;`);
 for(const [file,table] of [['20260830183929_audit_receivable_payments_and_reversals','receivable_payment_reversals'],['20260910024438_finance_receivable_movement_projection','finance_receivable_movement_links']]){
  let definition=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(definition);
  definition=definition.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await run(definition);
 }
 await run(readFileSync('supabase/migrations/20260910142740_finance_legacy_adoption_inventory.sql','utf8'));
 for(const file of ['20260910143833_finance_legacy_payable_associations.sql','20260910125357_finance_recorded_costs.sql','20260910130032_finance_payroll_recorded_costs.sql','20260910152557_finance_recorded_cost_summary.sql']){const sql=readFileSync('supabase/migrations/'+file,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const sql=(from=null,to=null,category=null,center=null,tenant=i.tenant)=>`select get_finance_recorded_cost_summary(${q(tenant)},${q(from)}::date,${q(to)}::date,${q(category)}::text,${q(center)}::text)`;
 const get=async(...args)=>recordedCostSummarySchema.parse(JSON.parse(await run(auth+sql(...args))));
 async function batch(n=1,payable=null,tenant=i.tenant){const id=randomUUID();await run(`insert into finance_expense_batches(id,tenant_id,context,description,created_by) values(${q(id)},${q(tenant)},'office','QA',${q(i.operator)});insert into finance_expense_items(id,tenant_id,batch_id,category,description,amount_cents,occurred_on,supplier_name,no_receipt_reason,payable_id,created_by) select gen_random_uuid(),${q(tenant)},${q(id)},'food','QA',101,'2026-01-01','Fornecedor','Recibo solicitado',${q(payable)}::uuid,${q(i.operator)} from generate_series(1,${n})`);}
 async function manual(date='2026-01-02T02:59:59Z',amount=100){const id=randomUUID();await run(`insert into payables(id,tenant_id,amount,status,supplier_name,category) values(${q(id)},${q(i.tenant)},${amount},'pending','QA','other');insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result,created_at) values(${q(i.tenant)},${q(randomUUID())},${q(i.operator)},'record_manual_expense',${q(JSON.stringify({category:'other',description:'Sede',amount_cents:amount*100}))},${q(JSON.stringify({payable_id:id}))},${q(date)})`);return id;}
 let period,entry,employee;
 async function payrollItem(type,nature,amount){await run(`insert into payroll_entry_items(id,tenant_id,payroll_period_id,payroll_entry_id,employee_id,item_type,nature,description,amount) values(gen_random_uuid(),${q(i.tenant)},${q(period)},${q(entry)},${q(employee)},${q(type)},${q(nature)},'QA',${amount})`);}
 const tests=[
 ['1005 canonical costs aggregate exactly and pass the real client schema',async()=>{await batch(1005);const r=await get();assert.equal(r.total_count,1005);assert.equal(r.total_cents,'101505');assert.equal(r.coverage_complete,false);assert.equal(r.excludes_bank_cash,true);assert.equal(r.months[0].amount_cents,'101505');}],
 ['manual alias deduplicates by exact payable ID and cancellation adds no expense',async()=>{await batch(1,await manual());const canceled=await manual();await run(`update payables set status='cancelled' where id=${q(canceled)}`);const r=await get();assert.equal(r.total_count,1007);assert.equal(r.cancelled_count,1);assert.equal(r.total_cents,'101606');}],
 ['payroll remuneration counted once without advances discounts or projected payable',async()=>{period=randomUUID();entry=randomUUID();employee=randomUUID();await run(`insert into employees(id,tenant_id,name) values(${q(employee)},${q(i.tenant)},'QA');insert into payroll_periods(id,tenant_id,status,period_start,period_end,period_name) values(${q(period)},${q(i.tenant)},'approved','2026-01-01','2026-01-31','QA');insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,status,entry_type) values(${q(entry)},${q(i.tenant)},${q(period)},${q(employee)},'approved','employee');insert into payables(id,tenant_id,supplier_name,category,amount,status,source_table,source_id) values(gen_random_uuid(),${q(i.tenant)},'QA','payroll',2000,'approved','payroll_entries',${q(entry)})`);await payrollItem('base_salary','credit',3000);await payrollItem('commission','credit',50);await payrollItem('driver_advance','already_paid',1000);await payrollItem('other','discount',50);const r=await get();assert.equal(r.total_count,1009);assert.equal(r.total_cents,'406606');assert.equal(r.payroll_unclassified_count,0);}],
 ['São Paulo dates and category filters preserve exact source boundaries',async()=>{await manual();await manual('2026-01-02T03:00:00Z',20);const r=await get('2026-01-02','2026-01-02','other','unassigned');assert.equal(r.total_count,1);assert.equal(r.total_cents,'2000');}],
 ['other tenant sources excluded and driver mixed role foreign tenant filters denied',async()=>{const before=await get();await batch(2,null,i.otherTenant);assert.deepEqual(await get(),before);await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+sql()),/access_denied/);await run(`insert into tenant_memberships values(${q(i.tenant)},${q(i.driverUser)},'operator',true)`);await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+sql()),/access_denied/);await assert.rejects(()=>run(auth+sql(null,null,null,null,i.otherTenant)),/access_denied/);await assert.rejects(()=>get('infinity'),/invalid_cost_filters/);await assert.rejects(()=>get(null,null,null,randomUUID()),/invalid_cost_center/);}],
 ['EXPLAIN ANALYZE complete aggregate over more than 1000 sources',async()=>{const source=readFileSync('supabase/migrations/20260910152557_finance_recorded_cost_summary.sql','utf8');const start=source.indexOf('with payroll as materialized');let body=source.slice(start,source.indexOf(' into result from summary s;')).replace(/\b_tenant\b/g,q(i.tenant)+'::uuid').replace(/\b_from\b/g,'null::date').replace(/\b_to\b/g,'null::date').replace(/\b_category\b/g,'null::text').replace(/\b_center\b/g,'null::text').replace(/\bcenter_id\b/g,'null::uuid')+' from summary s';const plan=await run(identity+'explain (analyze,buffers,format text) '+body);assert.match(plan,/Execution Time/);assert.match(plan,/rows=1011/);console.log('FULL BODY PLAN\n'+plan);}],
 ['inconsistent manual obligation and nonfinite date keep invalid counts and null all totals',async()=>{const id=await manual();await run(`update payables set amount=50 where id=${q(id)}`);await manual('infinity');const r=await get('2026-01-01','2026-01-01');assert.equal(r.invalid_count,2);assert.equal(r.total_cents,null);assert.equal(r.totals_valid,false);for(const group of [r.categories,r.cost_centers,r.months])assert.ok(group.every(row=>row.amount_cents===null));}],
 ['unclassified payroll credits remain visible and invalidate rather than double counting',async()=>{await payrollItem('driver_expense_reimbursement','credit',200);await payrollItem('driver_settlement','credit',500);const r=await get(null,null,'payroll');assert.equal(r.total_count,4);assert.equal(r.payroll_unclassified_count,2);assert.equal(r.invalid_count,2);assert.equal(r.total_cents,null);}]
 ];for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
