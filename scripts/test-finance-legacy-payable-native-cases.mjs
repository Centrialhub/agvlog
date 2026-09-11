import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';

// A narrow synthetic dependency fixture; all commands and capacity triggers are
// installed from the actual candidate SQL. Never uses a configured remote DB.
export async function runLegacyPayableNative({query,contested,literal:q,createRoles=false}){
 const database='finance_legacy_payable_qa';await query(`create database ${database}`);
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
 const identity=`set request.jwt.claim.sub=${q(i.operator)};`,auth=identity+'set role authenticated;';
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Conferência histórica executável QA'});
 const call=(name,p)=>`${auth}select ${name}(${q(JSON.stringify(p))}::jsonb)`;
 const association=p=>call('associate_finance_legacy_payable_payment',p);
 const reverse=p=>call('reverse_finance_legacy_payable_association',p);
 const race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 const fixtures=[];
 // Seed old payments before installing the canonical-only writer cutoff.
 for(let n=0;n<12;n++){
  const trip=randomUUID(),title=randomUUID(),otherTitle=randomUUID(),payment=randomUUID(),tx=randomUUID(),settlement=randomUUID(),settlementPayment=randomUUID();
  await run(`${identity}insert into dispatch_trips(id,tenant_id,driver_id,status) values(${q(trip)},${q(i.tenant)},${q(i.driver)},'completed');insert into payables(id,tenant_id,supplier_name,category,description,amount,due_date,status,driver_id) values
   (${q(title)},${q(i.tenant)},'Fornecedor antigo','other','Pagamento antigo',300,'2026-01-01','approved',${q(i.driver)}),
   (${q(otherTitle)},${q(i.tenant)},'Outro fornecedor','other','Pagamento concorrente',300,'2026-01-01','approved',${q(i.driver)});
   insert into bank_transactions(id,tenant_id,bank_account_id,posted_at,description,amount,transaction_type,raw_payload) values(${q(tx)},${q(i.tenant)},${q(i.account)},'2026-01-01T15:00:00Z','Baixa histórica',300,'debit','{}');
   insert into payables_payments(id,tenant_id,payable_id,amount,paid_at,bank_account_id,method,bank_transaction_id,created_by) values(${q(payment)},${q(i.tenant)},${q(title)},300,'2026-01-01T15:00:00Z',${q(i.account)},'pix',${q(tx)},${q(i.operator)});
   insert into driver_settlements(id,tenant_id,driver_id) values(${q(settlement)},${q(i.tenant)},${q(i.driver)});
   insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values(${q(settlementPayment)},${q(i.tenant)},${q(settlement)},300,'2026-01-01T15:00:00Z');`);
  const movement=JSON.parse(await run(call('record_finance_movement',{...base(),bank_account_id:i.account,driver_id:i.driver,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-01-01',description:'Saída documentada',beneficiary_name:'Motorista QA'}))).movement_id;
  fixtures.push({trip,title,otherTitle,payment,tx,settlement,settlementPayment,movement,payload:{...base(),payment_id:payment,movement_id:movement}});
 }
 for(const file of ['20260910120756_finance_manual_expense_recording.sql','20260910121937_finance_retire_legacy_payable_writers.sql','20260910143833_finance_legacy_payable_associations.sql']){
  const candidate=readFileSync('supabase/migrations/'+file,'utf8');assert.ok(candidate.trim(),file);await run('begin;'+candidate+'commit;');console.log(file+' SHA256 '+createHash('sha256').update(candidate).digest('hex'));
 }
 const snapshot=f=>run(`select jsonb_build_object('title',(select to_jsonb(t) from payables t where id=${q(f.title)}),'payment',(select to_jsonb(p) from payables_payments p where id=${q(f.payment)}),'bank',(select to_jsonb(b) from bank_transactions b where id=${q(f.tx)}),'movement',(select to_jsonb(m) from finance_movements m where id=${q(f.movement)}))`);
 async function take(){const f=fixtures.shift();f.before=await snapshot(f);f.payload.revision=await run(`select finance_private.legacy_payable_source_revision(${q(i.tenant)},${q(f.payment)})`);return f;}
 async function invariant(f,active=1){assert.equal(await snapshot(f),f.before);assert.equal(await run(`select count(*) from finance_payable_movement_links l where payment_id=${q(f.payment)} and not exists(select 1 from finance_payable_link_reversals r where r.link_id=l.id)`),String(active));}
 const standard=f=>call('apply_finance_payable_movement',{...base(),payable_id:f.otherTitle,movement_id:f.movement,amount_cents:30000,method:'pix'});
 const settlement=f=>call('link_finance_settlement_payment',{...base(),payment_id:f.settlementPayment,movement_id:f.movement});
 const expense=f=>call('record_finance_expense_batch',{...base(),context:'trip',trip_id:f.trip,description:'Lote concorrente',items:[{id:randomUUID(),category:'food',description:'Lanches',amount_cents:30000,occurred_on:'2026-01-01',supplier_name:'Fornecedor QA',no_receipt_reason:'Recibo solicitado',allocations:[{movement_id:f.movement,amount_cents:30000}]}]});
 const tests=[
  ['simultaneous replay preserves one link, original payment, title and money',async()=>{const f=await take();await race(association(f.payload),association(f.payload));await invariant(f);assert.equal(await run(`select count(*) from finance_payable_movement_links where payment_id=${q(f.payment)}`),'1');}],
  ['different requests for the same payment preserve one active association',async()=>{const f=await take();const result=await race(association(f.payload),association({...f.payload,request_id:randomUUID()}),{waiterSucceeds:false});assert.match(result.error,/already|exists|linked/);await invariant(f);}],
  ...[['standard payment',standard],['expense allocation',expense],['settlement allocation',settlement]].flatMap(([name,command])=>[
   [`association first preserves shared capacity against ${name}`,async()=>{const f=await take();const result=await race(association(f.payload),command(f),{waiterSucceeds:false});assert.match(result.error,/overallocated|capacity/);await invariant(f);}],
   [`${name} first rejects association atomically`,async()=>{const f=await take();const result=await race(command(f),association(f.payload),{waiterSucceeds:false});assert.match(result.error,/overallocated|capacity/);await invariant(f,0);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');}]
  ]),
  ['reversal and reassociation preserve paid status while restoring exactly one active link',async()=>{
   const f=await take(),first=JSON.parse(await run(association(f.payload)));const p={...base(),link_id:first.link_id};await race(reverse(p),association({...f.payload,request_id:randomUUID()}));await invariant(f);assert.equal(await run(`select count(*) from finance_payable_movement_links where payment_id=${q(f.payment)}`),'2');
   assert.equal(await run(`select count(*) from finance_private.active_payable_payments where id=${q(f.payment)}`),'1');
  }],
  ['privileged legacy payment edits are rejected after adoption',async()=>{
   const f=await take();await run(association(f.payload));await assert.rejects(()=>run(`update payables_payments set amount=299 where id=${q(f.payment)}`),/immutable|linked/);await assert.rejects(()=>run(`delete from payables_payments where id=${q(f.payment)}`),/immutable|linked/);await invariant(f);
  }],
  ['revocation during a proven wait denies association without partial writes',async()=>{
   const f=await take();const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,association(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(i.tenant)} and user_id=${q(i.operator)}`});assert.match(result.error,/finance_access_denied/);await invariant(f,0);
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');await run(`update tenant_memberships set active=true where user_id=${q(i.operator)}`);
  }],
  ['bank source changes after preview during a proven wait: revision rejects 40001 without adopting different money',async()=>{
   const f=await take();
   await assert.rejects(()=>run(`update payables_payments set amount=299 where id=${q(f.payment)}`),/immutable|linked/);
   const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,association(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update bank_transactions set amount=299 where id=${q(f.tx)}`});
   assert.match(result.error,/40001: finance_legacy_payment_changed/);
   const before=JSON.parse(f.before),after=JSON.parse(await snapshot(f));assert.equal(after.bank.amount,299);delete before.bank;delete after.bank;assert.deepEqual(after,before);
   assert.equal(await run(`select count(*) from finance_payable_movement_links where payment_id=${q(f.payment)}`),'0');
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
