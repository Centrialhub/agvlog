import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runReceivableTemporalNative({query,contested,literal:q,createRoles=false}){
 const database='finance_receivable_temporal_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
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

 // Final temporal migration hash must be supplied only after author freeze.
 const temporalFile='20260910195941_finance_receivable_temporal_foundation.sql';
 const temporal=readFileSync('supabase/migrations/'+temporalFile,'utf8');
 const expected='8246ff32ae6d1e95ed9b4dda8495315c08328e002266253dd2258b04a86269c3';assert.equal(createHash('sha256').update(temporal).digest('hex'),expected);
 console.log(temporalFile+' SHA256 '+expected);

 const client=randomUUID(),title=randomUUID();await run("insert into clients(id,tenant_id,company_name) values("+q(client)+","+q(i.tenant)+",'Temporal QA')");
 const ins=(id=title,tenant=i.tenant)=>"insert into receivables(id,tenant_id,client_id,description,amount,status,received_amount) values("+q(id)+","+q(tenant)+","+q(client)+",'Original',100,'pending',0)";
 await run(ins());await run("create table qa_temporal_release(at timestamptz not null)");
 const inverse='finance_temporal_inverse_qa',rollbackDb='finance_temporal_rollback_qa';
 await query('create database '+inverse+' template '+database);await query('create database '+rollbackDb+' template '+database);
 let passed=0;
 await contested("lock table tenants in row exclusive mode;update receivables set description='Committed before baseline' where id="+q(title),temporal,{database,driver:false,holderAfterBlocked:"insert into qa_temporal_release values(clock_timestamp())"});
 assert.equal(await run("select new_data->>'description' from finance_private.receivable_temporal_versions where receivable_id="+q(title)+" and operation='BASELINE'"),'Committed before baseline');assert.equal(await run('select coverage_starts_at >= (select at from qa_temporal_release) from finance_private.receivable_temporal_coverage where tenant_id='+q(i.tenant)),'t');passed++;console.log('PASS baseline waits for preexisting writer and captures committed final title');
 const txBody=temporal.replace(/^\s*(?:--[^\n]*\n)*begin;/i,'').replace(/commit;\s*$/i,'');const newTenant=randomUUID(),newTitle=randomUUID();
 await contested(txBody,"insert into tenants(id) values("+q(newTenant)+");"+ins(newTitle,newTenant),{database:inverse,driver:false});
 assert.equal(await query("select baseline_kind||':'||(select count(*) from finance_private.receivable_temporal_versions where receivable_id="+q(newTitle)+" and operation='INSERT') from finance_private.receivable_temporal_coverage where tenant_id="+q(newTenant),inverse),'new_tenant:1');passed++;console.log('PASS tenant and title created while migration holds locks get coverage plus INSERT after commit');

 const busy=await contested("update receivables set description='Writer survives' where id="+q(title),temporal,{database:rollbackDb,driver:false,waiterSucceeds:false,waitForBlocking:false});assert.match(busy.error,/55P03/);assert.doesNotMatch(busy.error,/40P01/);assert.equal(await query("select to_regclass('finance_private.receivable_temporal_versions') is null",rollbackDb),'t');assert.equal(await query("select description from receivables where id="+q(title),rollbackDb),'Writer survives');passed++;console.log('PASS receivable writer causes NOWAIT 55P03 with no deadlock or migration residue; writer commits');
 const orphan=randomUUID();await query(ins(orphan,randomUUID()),rollbackDb);
 await assert.rejects(()=>query(temporal,rollbackDb),/finance_receivable_temporal_orphan_tenant/);
 assert.equal(await query("select to_regclass('finance_private.receivable_temporal_versions') is null and not exists(select 1 from pg_trigger where tgname='z_receivable_temporal_capture')",rollbackDb),'t');passed++;console.log('PASS failed orphan baseline rolls back all history DDL and triggers');

 const bootstrapTenant=randomUUID(),bootstrapTitle=randomUUID();
 await run("create function public.qa_seed_temporal_title() returns trigger language plpgsql as $$begin insert into public.receivables(id,tenant_id,client_id,description,amount,status,received_amount) values('"+bootstrapTitle+"',new.id,'"+client+"','Bootstrap',10,'pending',0);return new;end$$;create trigger \"0_qa_seed_temporal_title\" after insert on tenants for each row execute function public.qa_seed_temporal_title()");
 await run("insert into tenants(id) values("+q(bootstrapTenant)+")");assert.equal(await run("select count(*) from finance_private.receivable_temporal_versions where receivable_id="+q(bootstrapTitle)+" and operation='INSERT'"),'1');await run('drop trigger "0_qa_seed_temporal_title" on tenants');const originalCoverage=await run("select row_to_json(c) from finance_private.receivable_temporal_coverage c where tenant_id="+q(bootstrapTenant));await run("insert into tenants(id) values("+q(bootstrapTenant)+") on conflict(id) do nothing");assert.equal(await run("select row_to_json(c) from finance_private.receivable_temporal_coverage c where tenant_id="+q(bootstrapTenant)),originalCoverage);passed++;console.log('PASS BEFORE tenant coverage permits earlier-named AFTER bootstrap title capture');
 const count=()=>run('select count(*) from finance_private.receivable_temporal_versions');let before=await count();
 await run("begin;"+identity+"update receivables set description='Rolled back' where id="+q(title)+";rollback;");assert.equal(await count(),before);
 await run("begin;set request.jwt.claim.sub='';update receivables set description='System update' where id="+q(title)+";commit;");assert.equal(await run("select actor_kind||':'||(actor_id is null)::text from finance_private.receivable_temporal_versions where receivable_id="+q(title)+" order by event_order desc limit 1"),'system:true');
 const doomed=randomUUID();await run(identity+ins(doomed)+";delete from receivables where id="+q(doomed));assert.equal(await run("select operation||':'||(new_data is null)::text from finance_private.receivable_temporal_versions where receivable_id="+q(doomed)+" order by event_order desc limit 1"),'DELETE:true');passed++;console.log('PASS rollback leaves no versions; system actor and exact DELETE tombstone retained');

 await assert.rejects(()=>run("insert into finance_private.receivable_temporal_versions(tenant_id,receivable_id,operation,new_data,actor_kind) values("+q(i.tenant)+","+q(randomUUID())+",'INSERT','{}','system')"),/23514/);
 await assert.rejects(()=>run("update receivables set tenant_id="+q(i.otherTenant)+" where id="+q(title)),/financial_receivable_identity_is_immutable|finance_receivable_temporal_identity_immutable/);
 for(const action of ['select * from','insert into']){const statement=action.startsWith('select')?action+' finance_private.receivable_temporal_versions':action+' finance_private.receivable_temporal_coverage values(gen_random_uuid(),now(),\'new_tenant\',\'transaction_capture_not_commit\',txid_current())';await assert.rejects(()=>run(auth+statement),/permission denied/);}
 await assert.rejects(()=>run('delete from finance_private.receivable_temporal_versions'),/finance_receivable_temporal_history_immutable/);await assert.rejects(()=>run('truncate receivables cascade'),/finance_receivable_temporal_history_immutable/);passed++;console.log('PASS private ACL, immutable history and source identity/truncate guards');
 const context=async()=>JSON.parse(await run(auth+'select get_receivable_financial_context('+q(i.tenant)+','+q(title)+')'));
 let ctx=await context();const receive={...base(),actor_id:i.operator,receivable_id:title,expected_revision:ctx.revision,action:'receive',amount_cents:2500,effective_date:'2026-09-01',bank_account_id:i.account,method:'pix'};
 before=await count();await run('begin;'+call('apply_receivable_financial_command',receive)+';rollback;');assert.equal(await count(),before);assert.equal(await run('select count(*) from receivables_payments'),'0');
 const paid=JSON.parse(await run(call('apply_receivable_financial_command',receive)));assert.equal(await run('select received_amount=25 from receivables where id='+q(title)),'t');
 assert.equal(await run("select count(distinct transaction_id) from finance_private.receivable_temporal_versions where receivable_id="+q(title)+" and actor_id="+q(i.operator)+" and operation='UPDATE'"),'1');
 ctx=await context();await run(call('apply_receivable_financial_command',{...base(),actor_id:i.operator,receivable_id:title,expected_revision:ctx.revision,action:'reverse',payment_id:paid.payment_id,refund_kind:'money_returned',reason:'Devolução real registrada',effective_date:'2026-09-02'}));
 assert.equal(await run('select received_amount=0 from receivables where id='+q(title)),'t');assert.equal(await run("select (new_data->>'received_amount')::numeric=0 from finance_private.receivable_temporal_versions where receivable_id="+q(title)+" order by event_order desc limit 1"),'t');passed++;console.log('PASS real receive and reversal capture recalculation atomically; rolled-back payment has no history or money');
 return passed;
}
