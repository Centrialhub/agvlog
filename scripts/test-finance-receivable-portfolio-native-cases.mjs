import assert from 'node:assert/strict';
import {receivablePortfolioSchema} from '../src/lib/financial/receivablePortfolioContract.ts';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runReceivablePortfolioNative({query,contested,literal:q,createRoles=false}){
 const database='finance_receivable_portfolio_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const type of baseline.matchAll(/CREATE TYPE public\.[a-z_]+ AS ENUM \([\s\S]*?\);/g))await run(type[0]);
 for(const table of ['clients','receivables','receivables_payments','bank_transactions','closing_reports','closing_report_payments','closing_report_history','client_invoices','payables','payables_payments','load_payments','employee_advances','driver_settlement_payments','payroll_entry_items']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);await run(`alter table ${table} add primary key(id)`);
 }
 await run(`alter table receivables add unique(tenant_id,id);alter table load_payments add column receivable_payment_id uuid,add column bank_transaction_id uuid;
 create schema storage;create table storage.objects(id uuid primary key,name text,bucket_id text);
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql as $$select finance_private.can_access($1)$$;
 create function public.apply_closing_report_action(jsonb) returns jsonb language plpgsql as $$begin raise exception 'qa_closing_not_enabled';end$$;`);
 for(const name of ['register_receivable_payment','reverse_receivable_payment','register_closing_report_payment']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];assert.ok(fn,name);await run(fn);
 }
 const preserve=readFileSync('supabase/migrations/20260830165149_make_closing_drafts_atomic.sql','utf8').match(/create function public\._preserve_closing_creation\([\s\S]*?\$fn\$;/)?.[0];assert.ok(preserve);await run(preserve);
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`;
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência de recebimento histórico QA'});
 const day='2026-01-01',fixtures=[];
 for(let n=0;n<0;n++){
  const client=randomUUID(),receivable=randomUUID(),other=randomUUID(),payment=randomUUID(),bank=randomUUID();
  await run(`insert into clients(id,tenant_id,company_name) values(${q(client)},${q(i.tenant)},'Cliente QA');
   insert into receivables(id,tenant_id,client_id,description,amount,status,received_amount,received_at) values
    (${q(receivable)},${q(i.tenant)},${q(client)},'Recebível antigo',300,'received',300,'2026-01-01T15:00:00Z'),
    (${q(other)},${q(i.tenant)},${q(client)},'Outro recebível',300,'pending',0,null);
   insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,amount,transaction_type,raw_payload) values(${q(bank)},${q(i.tenant)},${q(i.account)},'2026-01-01T15:00:00Z',300,'credit','{}');
   insert into receivables_payments(id,tenant_id,receivable_id,amount,received_at,bank_account_id,method,bank_transaction_id,created_by) values(${q(payment)},${q(i.tenant)},${q(receivable)},300,'2026-01-01T15:00:00Z',${q(i.account)},'pix',${q(bank)},${q(i.operator)});`);
  const movement=JSON.parse(await run(call('record_finance_movement',{...base(),bank_account_id:i.account,direction:'in',nature:'receipt',amount_cents:50000,occurred_on:day,description:'Entrada agrupada já registrada',beneficiary_name:'Cliente QA'}))).movement_id;
  fixtures.push({client,receivable,other,payment,bank,movement});
 }
 async function install(file){const sql=readFileSync('supabase/migrations/'+file,'utf8');assert.ok(sql.trim(),file);await run('begin;'+sql+'commit;');console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 await install('20260830183929_audit_receivable_payments_and_reversals.sql');
 await run(`create trigger qa_recalc_receipt after insert or update or delete on receivables_payments for each row execute function _recalc_receivable_received();`);
 await install('20260910024438_finance_receivable_movement_projection.sql');
 await install('20260910025658_finance_receipt_allocation_corrections.sql');
 await install('20260910030634_finance_explicit_receipt_refunds.sql');
 // Read-only inventory dependencies: real definitions, no unrelated graph FKs.
 for(const [file,table] of [['20260910002244_finance_payable_movement_links','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal','finance_payable_link_reversals'],['20260910130540_finance_settlement_movement_links','finance_settlement_movement_links'],['20260910132411_finance_settlement_link_reversals','finance_settlement_link_reversals'],['20260910011121_finance_fiscal_cancellation_credits','finance_customer_credits']]){
  let sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))?.[0];assert.ok(sql,table);
  sql=sql.replace(/ references public\.\w+\([^)]*\)/g,'');await run(sql);
 }
 await install('20260910142740_finance_legacy_adoption_inventory.sql');
 await run(`create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);`);
 await install('20260909233625_finance_audit_queries.sql');
 await install('20260910145616_finance_legacy_receipt_associations.sql');
 await install('20260910151617_finance_receivable_portfolio_summary.sql');
 const client=randomUUID();await run(`insert into clients(id,tenant_id,company_name) values(${q(client)},${q(i.tenant)},'Carteira 1005')`);
 const insert=(id,c,amount=100,created='2026-09-01T15:00:00Z',status='pending',due='2026-01-01')=>`insert into receivables(id,tenant_id,client_id,description,amount,status,received_amount,created_at,due_date) values(${q(id)},${q(i.tenant)},${q(c)},'Título QA',${amount},${q(status)},0,${q(created)},${q(due)})`;
 await run(`insert into receivables(id,tenant_id,client_id,description,amount,status,received_amount,created_at,due_date) select gen_random_uuid(),${q(i.tenant)},${q(client)},'Carteira '||n,100,'pending',0,'2026-09-01T15:00:00Z','2026-01-01' from generate_series(1,1005) n`);
 const sql=(c=client,from=null,to=null,tenant=i.tenant)=>`select get_finance_receivable_portfolio_summary(${q(tenant)},${q(from)}::date,${q(to)}::date,${q(c)}::uuid)`;
 const get=async(c=client,from=null,to=null)=>receivablePortfolioSchema.parse(JSON.parse(await run(auth+sql(c,from,to))));
 const tests=[
 ['complete 1005-title portfolio has exact cents and real client schema',async()=>{const r=await get();assert.equal(r.total_titles,1005);assert.equal(r.nominal_cents,'10050000');assert.equal(r.open_cents,'10050000');assert.equal(r.overdue_cents,'10050000');assert.equal(r.totals_valid,true);}],
 ['real canonical partial receive updates allocated and open amounts without cancel inflation',async()=>{
  const id=await run(`select id from receivables where client_id=${q(client)} order by id limit 1`);const ctx=JSON.parse(await run(`${auth}select get_receivable_financial_context(${q(i.tenant)},${q(id)})`));
  await run(call('apply_receivable_financial_command',{...base(),actor_id:i.operator,receivable_id:id,expected_revision:ctx.revision,action:'receive',amount_cents:2500,effective_date:'2026-09-01',bank_account_id:i.account,method:'pix'}));
  await run(insert(randomUUID(),client,999,'2026-09-01T15:00:00Z','cancelled'));
  const r=await get();assert.equal(r.total_titles,1005);assert.equal(r.canceled_titles,1);assert.equal(r.received_allocated_cents,'2500');assert.equal(r.open_cents,'10047500');assert.equal(r.status_rows.find(s=>s.status==='partial').count,1);
 }],
 ['São Paulo day selects exact lower and upper bounds',async()=>{const c=randomUUID();await run(`insert into clients(id,tenant_id,company_name) values(${q(c)},${q(i.tenant)},'Datas')`);for(const d of ['2026-09-01T02:59:59Z','2026-09-01T03:00:00Z','2026-09-02T02:59:59Z','2026-09-02T03:00:00Z'])await run(insert(randomUUID(),c,100,d));const r=await get(c,'2026-09-01','2026-09-01');assert.equal(r.total_titles,2);assert.equal(r.nominal_cents,'20000');}],
 ['invalid amount and nonfinite creation or due date invalidate every monetary total',async()=>{for(const [amount,date,due] of [['NaN','2026-09-01T15:00:00Z','2026-01-01'],['100','infinity','2026-01-01'],['100','2026-09-01T15:00:00Z','infinity']]){const c=randomUUID();await run(`insert into clients(id,tenant_id,company_name) values(${q(c)},${q(i.tenant)},'Inválido')`);await run(insert(randomUUID(),c,q(amount),date,'pending',due));const r=await get(c,'2026-09-01','2026-09-01');assert.equal(r.invalid_titles,1);assert.equal(r.totals_valid,false);for(const key of ['nominal_cents','received_allocated_cents','open_cents','overdue_cents'])assert.equal(r[key],null);}}],
 ['driver, mixed role, foreign tenant and invalid filter denied',async()=>{await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+sql()),/access_denied/);await run(`insert into tenant_memberships values(${q(i.tenant)},${q(i.driverUser)},'operator',true)`);await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.driverUser)};set role authenticated;`+sql()),/access_denied/);await assert.rejects(()=>run(auth+sql(null,null,null,i.otherTenant)),/access_denied/);await assert.rejects(()=>get(client,'2026-09-02','2026-09-01'),/invalid_filters/);}],
 ['EXPLAIN ANALYZE executes full portfolio and materialized snapshot once per title',async()=>{
  const source=readFileSync('supabase/migrations/20260910151617_finance_receivable_portfolio_summary.sql','utf8');let body=source.slice(source.indexOf('with selected as materialized'),source.indexOf(' into result from summary s;')).replaceAll('_tenant',q(i.tenant)+'::uuid').replaceAll('_client',q(client)+'::uuid').replaceAll('_from',"null::date").replaceAll('_to',"null::date").replace(/\btoday\b/g,"date '2026-09-10'")+ ' from summary s';
  const plan=await run(identity+'explain (analyze,buffers,format text) '+body);assert.match(plan,/Execution Time/);assert.match(plan,/rows=1005/);console.log('FULL BODY PLAN\n'+plan);
 }]
 ];for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
