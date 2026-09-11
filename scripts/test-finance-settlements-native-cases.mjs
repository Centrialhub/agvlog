import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';

// A narrow synthetic dependency fixture; all commands and capacity triggers are
// installed from the actual candidate SQL. Never uses a configured remote DB.
export async function runSettlementLinksNative({query,contested,literal:q,createRoles=false}){
 const database='finance_settlement_links_qa';await query(`create database ${database}`);
 const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 await run(`alter table drivers add column name text default 'Motorista QA';
 create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
 create table cost_centers(id uuid primary key,tenant_id uuid,name text,active boolean);
 create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text);
 create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,destination text);
 create table fiscal_documents(id uuid primary key,tenant_id uuid,supplier_id uuid,client_id uuid);
 create table dispatch_stop_documents(id uuid primary key,tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);
 create table receivables(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,description text,amount numeric,status text,due_date date,created_by uuid);
 create table payables(id uuid primary key default gen_random_uuid(),tenant_id uuid,supplier_name text,supplier_id uuid,
  category text,description text,amount numeric,due_date date,competence_date date,status text,driver_id uuid,dispatch_trip_id uuid,
  document_number text,receipt_url text,created_by uuid,source_table text,source_id uuid,cost_center text,
  paid_amount numeric default 0,paid_at timestamptz,updated_at timestamptz);
 create table bank_transactions(id uuid primary key);
 create table finance_statement_imports(id uuid primary key,tenant_id uuid,file_name text);
 create table finance_statement_rows(id uuid primary key,tenant_id uuid,source_row integer);
 create table payroll_periods(id uuid primary key,tenant_id uuid,status text default 'approved',period_start date default current_date,closed_by uuid,closed_at timestamptz,notes text,updated_at timestamptz);
 create table employees(id uuid primary key,tenant_id uuid,name text,doc_cpf text,branch text,department text);
 create table payroll_entries(id uuid primary key,tenant_id uuid,payroll_period_id uuid,employee_id uuid,status text,amount_to_pay numeric(14,2),already_paid_amount numeric(14,2),gross_amount numeric(14,2),discount_amount numeric(14,2),created_at timestamptz default now());
 create table payables_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,payable_id uuid,amount numeric,
  paid_at timestamptz,bank_account_id uuid,method text,notes text,attachment_url text,bank_transaction_id uuid,created_by uuid);
 `);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 await run('create function public.is_tenant_admin(uuid) returns boolean language sql as $$select true$$;');
 for(const name of ['_recalc_payable_paid','reverse_payable_payment','close_payroll_period']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
  if(!body)throw new Error(`Missing ${name}`);await run(body);
 }
 await run('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();grant execute on function reverse_payable_payment(uuid) to authenticated;');
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260909220020_finance_expense_workspace_queries.sql','20260909233625_finance_audit_queries.sql','20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await run(readFileSync(`supabase/migrations/${file}`,'utf8'));

 await run('create table driver_settlements(id uuid primary key,tenant_id uuid,driver_id uuid);create table driver_settlement_payments(id uuid primary key,tenant_id uuid,settlement_id uuid,amount numeric(14,2),paid_at timestamptz);');
 const target='20260910130540_finance_settlement_movement_links.sql',sql=readFileSync('supabase/migrations/'+target,'utf8');
 await run('begin;'+sql+'commit;');console.log('Settlement candidate '+target+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 for(const file of ['20260910130921_finance_settlement_movement_options.sql','20260910131149_finance_settlement_link_audit.sql','20260910132411_finance_settlement_link_reversals.sql']){
  const candidate=readFileSync('supabase/migrations/'+file,'utf8');await run('begin;'+candidate+'commit;');
  console.log('Settlement candidate '+file+' SHA256 '+createHash('sha256').update(candidate).digest('hex'));
 }
 const auth=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`;
 const call=(rpc,p)=>`${auth}select ${rpc}(${q(JSON.stringify(p))}::jsonb)`;
 const base=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Registro conferido pelo financeiro QA'});
 const race=(holder,waiter,opts={})=>contested(holder,waiter,{database,driver:false,...opts});
 async function fixture(){
  await run(`update tenant_memberships set active=true where user_id=${q(i.operator)}`);
  const settlement=randomUUID(),payment=randomUUID(),title=randomUUID(),trip=randomUUID();
  await run(`insert into dispatch_trips values(${q(trip)},${q(i.tenant)},${q(i.driver)},'completed');insert into driver_settlements values(${q(settlement)},${q(i.tenant)},${q(i.driver)});insert into driver_settlement_payments values(${q(payment)},${q(i.tenant)},${q(settlement)},300,'2026-01-01T12:00:00Z');insert into payables(id,tenant_id,supplier_name,category,amount,status) values(${q(title)},${q(i.tenant)},'Fornecedor QA','other',300,'approved')`);
  const movement=JSON.parse(await run(call('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',driver_id:i.driver,amount_cents:50000,occurred_on:'2026-01-01',description:'Envio agrupado',beneficiary_name:'Motorista QA'}))).movement_id;
  const moneyCount=await run('select count(*) from finance_movements'),settlementPaymentCount=await run('select count(*) from driver_settlement_payments');
  return {movement,payment,title,trip,settlement,moneyCount,settlementPaymentCount,link:{...base(),payment_id:payment,movement_id:movement}};
 }
 const link=p=>call('link_finance_settlement_payment',p);
 const payable=f=>call('apply_finance_payable_movement',{...base(),movement_id:f.movement,payable_id:f.title,amount_cents:30000,method:'pix'});
 const expense=f=>call('record_finance_expense_batch',{...base(),context:'trip',trip_id:f.trip,description:'Lote concorrente',items:[{id:randomUUID(),category:'food',description:'Lanches',amount_cents:30000,occurred_on:'2026-01-01',supplier_name:'Fornecedor QA',no_receipt_reason:'Comprovante solicitado',allocations:[{movement_id:f.movement,amount_cents:30000}]}]});
 const reverse=p=>call('reverse_finance_settlement_link',p);
 async function linkedFixture(){
  const f=await fixture(),original=JSON.parse(await run(link(f.link)));
  const cash=await run(`select json_build_object('movement',(select to_jsonb(m) from finance_movements m where id=${q(f.movement)}),'payment',(select to_jsonb(p) from driver_settlement_payments p where id=${q(f.payment)}),'bank',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from bank_transactions b))`);
  return {...f,cash,original,reversal:{...base(),link_id:original.link_id}};
 }
 async function preserved(f,{active,history,reversals,used}){
  assert.equal(await run(`select json_build_object('movement',(select to_jsonb(m) from finance_movements m where id=${q(f.movement)}),'payment',(select to_jsonb(p) from driver_settlement_payments p where id=${q(f.payment)}),'bank',(select coalesce(jsonb_agg(to_jsonb(b)),'[]') from bank_transactions b))`),f.cash);
  assert.equal(await run('select count(*) from finance_movements'),f.moneyCount);
  assert.equal(await run('select count(*) from driver_settlement_payments'),f.settlementPaymentCount);
  assert.equal(await run(`select count(*) from finance_settlement_movement_links l where l.payment_id=${q(f.payment)} and not exists(select 1 from finance_settlement_link_reversals r where r.link_id=l.id)`),String(active));
  assert.equal(await run(`select count(*) from finance_settlement_movement_links where payment_id=${q(f.payment)}`),String(history));
  assert.equal(await run(`select count(*) from finance_settlement_link_reversals r join finance_settlement_movement_links l on l.id=r.link_id where l.payment_id=${q(f.payment)}`),String(reversals));
  assert.equal(await run(`select finance_private.movement_used_cents(${q(i.tenant)},${q(f.movement)})`),String(used));
 }
 async function counts(f,expected){
  const actual=JSON.parse(await run(`select json_build_array((select count(*) from finance_settlement_movement_links where movement_id=${q(f.movement)}),(select count(*) from finance_payable_movement_links where movement_id=${q(f.movement)}),(select count(*) from finance_expense_allocations where movement_id=${q(f.movement)}),(select count(*) from finance_movements where id=${q(f.movement)}),(select count(*) from driver_settlement_payments where id=${q(f.payment)}))`));
  assert.deepEqual(actual,expected);
  assert.equal(await run('select count(*) from finance_movements'),f.moneyCount);
  assert.equal(await run('select count(*) from driver_settlement_payments'),f.settlementPaymentCount);
  assert.equal(await run('select count(*) from bank_transactions'),'0');
  assert.equal(await run(`select finance_private.movement_used_cents(${q(i.tenant)},${q(f.movement)})`),'30000');
 }
 const tests=[
  ['settlement and movement both lacking a driver cannot be linked',async()=>{
   const f=await fixture();await run(`update driver_settlements set driver_id=null where id=${q(f.settlement)}`);
   const movement=JSON.parse(await run(call('record_finance_movement',{...base(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,occurred_on:'2026-01-01',description:'Sem motorista identificado',beneficiary_name:'Beneficiário QA'}))).movement_id;
   const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,link({...f.link,movement_id:movement}),{waiterSucceeds:false});
   assert.match(result.error,/finance_settlement_payment_mismatch/);
   assert.equal(await run(`select count(*) from finance_settlement_movement_links where payment_id=${q(f.payment)}`),'0');
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.link.request_id)}`),'0');
  }],
  ['same request waits and replays one link without creating money or payment',async()=>{
   const f=await fixture();const result=await race(link(f.link),link(f.link));
   const replay=JSON.parse(result.output.trim().split('\n').at(-1));
   const original=JSON.parse(await run(link(f.link)));assert.deepEqual(replay,original);assert.equal(original.cash_created,false);
   await counts(f,[1,0,0,1,1]);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.link.request_id)}`),'1');
  }],
  ['distinct request keys cannot link the same payment twice',async()=>{
   const f=await fixture(),result=await race(link(f.link),link({...f.link,request_id:randomUUID()}),{waiterSucceeds:false});
   assert.match(result.error,/finance_settlement_payment_already_linked/);await counts(f,[1,0,0,1,1]);
  }],
  ...['payable','expense'].flatMap(kind=>[true,false].map(settlementFirst=>[`${kind} and settlement compete for shared capacity; settlement ${settlementFirst?'first':'second'}`,async()=>{
   const f=await fixture(),other=kind==='payable'?payable(f):expense(f);
   const result=await race(settlementFirst?link(f.link):other,settlementFirst?other:link(f.link),{waiterSucceeds:false});
   assert.match(result.error,/finance_movement_overallocated/);
   await counts(f,settlementFirst?[1,0,0,1,1]:kind==='payable'?[0,1,0,1,1]:[0,0,1,1,1]);
   assert.equal(await run(`select count(*) from payables_payments where payable_id=${q(f.title)}`),!settlementFirst&&kind==='payable'?'1':'0');
  }])),
  ['membership revoked while command waits prevents link, event and command',async()=>{
   const f=await fixture(),result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,link(f.link),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(result.error,/finance_access_denied/);
   assert.equal(await run(`select count(*) from finance_settlement_movement_links where payment_id=${q(f.payment)}`),'0');
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.link.request_id)}`),'0');
   assert.equal(await run(`select count(*) from finance_events where entity_id=${q(f.payment)}`),'0');
  }],
  ['reversal waits and replays exactly once without changing historical payment or cash',async()=>{
   const f=await linkedFixture(),result=await race(reverse(f.reversal),reverse(f.reversal));
   const replay=JSON.parse(result.output.trim().split('\n').at(-1)),original=JSON.parse(await run(reverse(f.reversal)));
   assert.deepEqual(replay,original);assert.equal(original.cash_changed,false);
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.reversal.request_id)}`),'1');
   assert.equal(await run(`select count(*) from finance_events where entity_id=${q(f.payment)} and action='settlement_link_reversed'`),'1');
   await preserved(f,{active:0,history:1,reversals:1,used:0});
  }],
  ['two distinct reversal requests cannot reverse the same association twice',async()=>{
   const f=await linkedFixture(),second={...f.reversal,request_id:randomUUID()};
   const result=await race(reverse(f.reversal),reverse(second),{waiterSucceeds:false});assert.match(result.error,/finance_settlement_link_already_reversed/);
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(second.request_id)}`),'0');
   await preserved(f,{active:0,history:1,reversals:1,used:0});
  }],
  ['a relink waiting for reversal uses only the released capacity and preserves both histories',async()=>{
   const f=await linkedFixture(),relink={...f.link,request_id:randomUUID()};await race(reverse(f.reversal),link(relink));
   await preserved(f,{active:1,history:2,reversals:1,used:30000});
   const options=JSON.parse(await run(`${auth}select get_finance_settlement_payment_movements(${q(i.tenant)},${q(f.payment)},1)`));
   assert.equal(options.history.length,2);assert.equal(options.history.filter(h=>h.reversal!==null).length,1);assert.ok(options.link);assert.notEqual(options.link.id,f.original.link_id);
  }],
  ['competing relinks after reversal cannot leave two active associations',async()=>{
   const f=await linkedFixture();await run(reverse(f.reversal));
   const result=await race(link({...f.link,request_id:randomUUID()}),link({...f.link,request_id:randomUUID()}),{waiterSucceeds:false});
   assert.match(result.error,/finance_settlement_payment_already_linked/);await preserved(f,{active:1,history:2,reversals:1,used:30000});
  }],
  ['payable waiting for reversal consumes released capacity and prevents overallocated relink',async()=>{
   const f=await linkedFixture();await race(reverse(f.reversal),payable(f));
   const result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,link({...f.link,request_id:randomUUID()}),{waiterSucceeds:false});
   assert.match(result.error,/finance_movement_overallocated/);await preserved(f,{active:0,history:1,reversals:1,used:30000});
  }],
  ['membership revoked while reversal waits prevents correction and preserves active capacity',async()=>{
   const f=await linkedFixture(),result=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,reverse(f.reversal),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});
   assert.match(result.error,/finance_access_denied/);await preserved(f,{active:1,history:1,reversals:0,used:30000});
   assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.reversal.request_id)}`),'0');
   assert.equal(await run(`select count(*) from finance_events where entity_id=${q(f.payment)} and action='settlement_link_reversed'`),'0');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
