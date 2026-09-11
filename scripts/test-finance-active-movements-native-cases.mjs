import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';

// A narrow synthetic dependency fixture; all commands and capacity triggers are
// installed from the actual candidate SQL. Never uses a configured remote DB.
export async function runActiveMovementNative({query,contested,literal:q,createRoles=false}){
 const database='finance_active_movement_qa';await query(`create database ${database}`);
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
 await run(baseline.match(/CREATE OR REPLACE FUNCTION public\.is_tenant_admin\([\s\S]*?\$function\$;/)[0]);
 for(const name of ['_recalc_payable_paid','reverse_payable_payment','close_payroll_period','register_payable_payment','create_manual_expense']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
  if(!body)throw new Error(`Missing ${name}`);await run(body);
 }
 await run('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();grant execute on function reverse_payable_payment(uuid) to authenticated;');
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260909220020_finance_expense_workspace_queries.sql','20260909233625_finance_audit_queries.sql','20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await run(readFileSync(`supabase/migrations/${file}`,'utf8'));


 const target='20260910130540_finance_settlement_movement_links.sql',sql=readFileSync('supabase/migrations/'+target,'utf8');
 await run('begin;'+sql+'commit;');console.log('Settlement candidate '+target+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
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
 await run(readFileSync('supabase/migrations/20260910143833_finance_legacy_payable_associations.sql','utf8'));
 for(const [file,table] of [['20260910025658_finance_receipt_allocation_corrections','finance_receipt_allocation_corrections'],['20260910145616_finance_legacy_receipt_associations','finance_legacy_receipt_movement_links'],['20260910145616_finance_legacy_receipt_associations','finance_legacy_receipt_link_reversals']]){
  let ddl=readFileSync(`supabase/migrations/${file}.sql`,'utf8').match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\n\\);`,'i'))[0];ddl=ddl.replace(/,\s*foreign key\([^;]+?(?=,\s*foreign key|\s*\n\);)/gi,'').replace(/ references public\.\w+\([^)]*\)/g,'');await run(ddl);
 }
 const receiptSql=readFileSync('supabase/migrations/20260910145616_finance_legacy_receipt_associations.sql','utf8'),idx=receiptSql.indexOf('function finance_private.receipt_movement_used_cents(');await run(receiptSql.slice(receiptSql.lastIndexOf('create',idx),receiptSql.indexOf('$$;',idx)+3));
 for(const file of ['20260910182541_finance_movement_correction_foundation','20260910183506_finance_active_movement_financial_guards','20260910184213_finance_movement_active_reference']){const sql=readFileSync(`supabase/migrations/${file}.sql`,'utf8');await run(sql);console.log(file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));}
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const financeLock=`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant)}::text||':finance',0));`;
 const payload=(reference=randomUUID())=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:5000,occurred_on:'2026-01-20',description:'Saída QA nativa',beneficiary_name:'Fornecedor QA',bank_reference:reference,reason:'Registro para validação nativa'});
 const command=p=>`${auth}select record_finance_movement(${q(JSON.stringify(p))}::jsonb)`;
 const record=async p=>JSON.parse(await run(command(p)));
 const race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 const reject=async(sql,message)=>{await assert.rejects(()=>run(sql),e=>String(e).includes(message));};
 const voidOwner=async(m,request)=>{const v=randomUUID();await run(`${identity}insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values(${q(i.tenant)},${q(v)},${q(i.operator)},'qa_void_storage','{}','{}');insert into finance_movement_voids(tenant_id,movement_id,original_request_id,request_id,kind,actor_id,actor_name,reason,revision,source_snapshot) values(${q(i.tenant)},${q(m)},${q(request)},${q(v)},'void',${q(i.operator)},'QA','Owner fixture somente, sem comando público',md5('QA'),jsonb_build_object('id',${q(m)}::text));`);};
 let passed=0;
 {
  const p=payload(),old=await record(p);await reject(command(payload(p.bank_reference)),'finance_reference_already_recorded');await voidOwner(old.movement_id,p.request_id);
  const next=await record(payload(p.bank_reference));assert.notEqual(next.movement_id,old.movement_id);assert.deepEqual(await record(p),old);await reject(command(payload(p.bank_reference)),'finance_reference_already_recorded');
  assert.equal(await run(`select count(*) from finance_movements where bank_reference=${q(p.bank_reference)}`),'2');assert.equal(await run(`select count(*) from finance_private.active_movements where bank_reference=${q(p.bank_reference)}`),'1');
  await reject(`update finance_movements set description='Modificado' where id=${q(old.movement_id)}`,'finance_immutable_record');passed++;console.log('PASS active reference + original replay + immutable raw money');
 }
 {
  const p=payload(),other=payload(p.bank_reference);const r=await race(command(p),command(other),{waiterSucceeds:false});assert.match(r.error,/finance_reference_already_recorded/);assert.equal(await run(`select count(*) from finance_movements where bank_reference=${q(p.bank_reference)}`),'1');passed++;console.log('PASS concurrent distinct requests same active reference');
 }
 {
  const p=payload();await record(p);const r=await race(`${financeLock}update tenant_memberships set active=false where user_id=${q(i.operator)}`,command(p),{waiterSucceeds:false});assert.match(r.error,/finance_access_denied/);await run(`update tenant_memberships set active=true where user_id=${q(i.operator)}`);assert.equal(await run(`select count(*) from finance_movements where bank_reference=${q(p.bank_reference)}`),'1');passed++;console.log('PASS revoked while waiting rejects original replay');
 }
 // A real batch command supplies an existing allocation for the row-first race.
 const p=payload(),m=await record(p),expense=randomUUID();
 const batch={version:1,tenant_id:i.tenant,request_id:randomUUID(),context:'office',description:'Material QA',reason:'Documento conferido para teste',items:[{id:expense,category:'office',description:'Material QA',amount_cents:1000,occurred_on:'2026-01-20',supplier_name:'Fornecedor QA',no_receipt_reason:'Sem recibo neste ensaio',allocations:[{movement_id:m.movement_id,amount_cents:1000}]}]};
 await run(`${auth}select record_finance_expense_batch(${q(JSON.stringify(batch))}::jsonb)`);
 const allocation=await run(`select id from finance_expense_allocations where expense_id=${q(expense)}`);await run('create table qa_busy(message text,state text)');
 {
  const holder=`${identity}select 1 from finance_expense_allocations where id=${q(allocation)} for update`;
  const waiter=`${identity}${financeLock}select 1 from finance_expense_allocations where id=${q(allocation)} for update`;
  const after=`do $$begin begin update finance_expense_allocations set amount_cents=amount_cents+1 where id=${q(allocation)};raise exception 'expected retryable rejection';exception when serialization_failure then if sqlerrm<>'finance_movement_use_busy' then raise;end if;insert into qa_busy values(sqlerrm,sqlstate);end;end$$;`;
  await race(holder,waiter,{holderAfterBlocked:after});assert.equal(await run('select state from qa_busy'),'40001');assert.equal(await run(`select amount_cents from finance_expense_allocations where id=${q(allocation)}`),'1000');passed++;console.log('PASS real allocation row-first versus finance-first returns 40001 without deadlock');
 }
 {
  await voidOwner(m.movement_id,p.request_id);
  await reject(`${identity}insert into finance_expense_allocations(tenant_id,expense_id,movement_id,amount_cents,created_by) values(${q(i.tenant)},${q(expense)},${q(m.movement_id)},1,${q(i.operator)})`,'finance_movement_voided');
  assert.equal(await run(`select amount_cents from finance_expense_allocations where id=${q(allocation)}`),'1000');
  assert.equal(await run(`${identity}select finance_private.available_movement_cents(${q(i.tenant)},${q(m.movement_id)},'out')`),'0');passed++;console.log('PASS voided source rejects residual allocation while historical allocation remains');
 }
 return passed;
}
