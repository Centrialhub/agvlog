import {build} from 'esbuild';
const compiledContract=await build({entryPoints:['src/lib/financial/receivablePaymentsContract.ts'],bundle:true,write:false,platform:'node',format:'esm'});
const {receivablePaymentsPageSchema}=await import('data:text/javascript;base64,'+Buffer.from(compiledContract.outputFiles[0].text).toString('base64'));
import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runReceivablePaymentsPageNative({query,contested,literal:q,createRoles=false}){
 const database='finance_receivable_payments_page_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
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



 const file='20260910202421_finance_receivable_payments_page.sql',sql=readFileSync('supabase/migrations/'+file,'utf8');assert.equal(createHash('sha256').update(sql).digest('hex'),'e0873d2419bb9663e6ddc2e3483e648c0366852ca5b0794fb38e7834557bdd7b');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 const client=randomUUID(),title=randomUUID();await run("insert into clients(id,tenant_id,company_name) values("+q(client)+","+q(i.tenant)+",'Pagamentos QA');insert into receivables(id,tenant_id,client_id,description,amount,status,received_amount) values("+q(title)+","+q(i.tenant)+","+q(client)+",'Título parcelado',100,'pending',0)");
 const context=async()=>JSON.parse(await run(auth+'select get_receivable_financial_context('+q(i.tenant)+','+q(title)+')'));
 const command=async payload=>JSON.parse(await run(call('apply_receivable_financial_command',payload)));
 const paymentIds=[];for(let n=0;n<51;n++){const c=await context(),p=await command({...base(),actor_id:i.operator,receivable_id:title,expected_revision:c.revision,action:'receive',amount_cents:1,effective_date:'2026-09-01',bank_account_id:i.account,method:'pix'});paymentIds.push(p.payment_id);}
 const read=async(page=1,revision=null,tenant=i.tenant,id=title)=>receivablePaymentsPageSchema.parse(JSON.parse(await run(auth+'select get_finance_receivable_payments_page('+q(tenant)+','+q(id)+','+page+','+q(revision)+')')));
 const first=await read(),second=await read(2,first.revision);assert.equal(first.total,51);assert.equal(first.rows.length,50);assert.equal(second.rows.length,1);assert.deepEqual([...first.rows,...second.rows].map(x=>x.id).sort(),paymentIds.sort());let passed=1;console.log('PASS 51 real receipts paginate 50+1 with public RPC and real UI parser');
 const original=await run('select row_to_json(p) from receivables_payments p where id='+q(paymentIds[0])),idsBefore=await run('select md5(string_agg(id::text,\',\' order by id)) from receivables_payments');
 const reverse={...base(),actor_id:i.operator,receivable_id:title,expected_revision:(await context()).revision,action:'reverse',payment_id:paymentIds[0],refund_kind:'money_returned',effective_date:'2026-09-02'};
 const reversed=await command(reverse);await assert.rejects(()=>read(2,first.revision),e=>/40001/.test(String(e))&&/finance_history_changed/.test(String(e)));
 const fresh=await read(),tail=await read(2,fresh.revision);assert.equal(fresh.total,51);assert.equal([...fresh.rows,...tail.rows].find(x=>x.id===paymentIds[0]).reversed_at!==null,true);assert.equal(await run('select md5(string_agg(id::text,\',\' order by id)) from receivables_payments'),idsBefore);assert.equal(await run('select row_to_json(p) from receivables_payments p where id='+q(paymentIds[0])),original);
 const money=()=>run("select jsonb_build_object('movements',(select count(*) from finance_movements),'bank',(select count(*) from bank_transactions),'reversals',(select count(*) from receivable_payment_reversals))");const beforeReplay=await money();assert.deepEqual(await command(reverse),reversed);assert.equal(await money(),beforeReplay);passed++;console.log('PASS real refund invalidates revision with unchanged payment IDs/count; original retained and replay adds no refund');
 await assert.rejects(()=>read(1,null,i.otherTenant),/finance_access_denied/);await assert.rejects(()=>read(1,null,i.tenant,randomUUID()),/financial_receivable_not_found/);await run('insert into tenant_memberships values('+q(i.tenant)+','+q(i.operator)+",'driver',true)");await assert.rejects(()=>read(),/finance_access_denied/);await run('delete from tenant_memberships where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator)+" and role='driver'");const current=await read();await run('update tenant_memberships set active=false where tenant_id='+q(i.tenant)+' and user_id='+q(i.operator));await assert.rejects(()=>read(2,current.revision),/finance_access_denied/);passed++;console.log('PASS tenant/source isolation, mixed driver and current revocation enforced');
 return passed;
}
