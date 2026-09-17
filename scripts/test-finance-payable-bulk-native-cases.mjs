import assert from 'node:assert/strict';
import {createHash,randomUUID} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as ids} from '../src/test/helpers/financeLedgerDatabase.ts';

export async function runPayableBulkNative({query,contested,literal:q,createRoles=false}){
 const migration='supabase/migrations/20260914205842_finance_payable_bulk_settlement.sql';
 const migrationSql=readFileSync(migration,'utf8');
 const migrationHash=createHash('sha256').update(migrationSql).digest('hex');
 assert.equal(migrationHash,'31cd3b8ef3f8ca3505b1ce5c6a34bb599e6d4f7f3947a1658d94e80c4cb4d02a');
 const database='finance_payable_bulk_qa';
 await query(`create database ${database}`);
 const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,number)=>q(params[Number(number)-1])))},createRoles);
 await run(`alter table drivers add column name text default 'Motorista QA';
 create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
 create table cost_centers(id uuid primary key,tenant_id uuid,name text,active boolean);
 create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text);
 create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,destination text);
 create table fiscal_documents(id uuid primary key,tenant_id uuid,supplier_id uuid,client_id uuid);
 create table dispatch_stop_documents(id uuid primary key,tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);
 create table receivables(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,description text,amount numeric,status text,due_date date,created_by uuid);
 create table payables(id uuid primary key default gen_random_uuid(),tenant_id uuid,supplier_name text,supplier_id uuid,category text,description text,amount numeric,due_date date,competence_date date,status text,driver_id uuid,dispatch_trip_id uuid,document_number text,receipt_url text,created_by uuid,source_table text,source_id uuid,cost_center text,paid_amount numeric default 0,paid_at timestamptz,updated_at timestamptz);
 create table bank_transactions(id uuid primary key);
 create table payroll_periods(id uuid primary key,tenant_id uuid,status text default 'approved',period_start date default current_date,closed_by uuid,closed_at timestamptz,notes text,updated_at timestamptz);
 create table employees(id uuid primary key,tenant_id uuid,name text,doc_cpf text,branch text,department text);
 create table payroll_entries(id uuid primary key,tenant_id uuid,payroll_period_id uuid,employee_id uuid,status text,amount_to_pay numeric(14,2),already_paid_amount numeric(14,2),gross_amount numeric(14,2),discount_amount numeric(14,2),created_at timestamptz default now());
 create table payables_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,payable_id uuid,amount numeric,paid_at timestamptz,bank_account_id uuid,method text,notes text,attachment_url text,bank_transaction_id uuid,created_by uuid);`);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const name of ['_recalc_payable_paid','close_payroll_period']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];
  assert.ok(body,`Missing ${name}`);await run(body);
 }
 await run('create trigger recalc after insert or update or delete on payables_payments for each row execute function _recalc_payable_paid();');
 for(const file of ['20260909212514_finance_delivery_unloading.sql','20260909213959_finance_expense_batches.sql','20260909220020_finance_expense_workspace_queries.sql','20260909233625_finance_audit_queries.sql','20260910000731_finance_payroll_payment_projection.sql','20260910002244_finance_payable_movement_links.sql','20260910003529_finance_payable_link_reversal.sql'])await run(readFileSync(`supabase/migrations/${file}`,'utf8'));
 await run(readFileSync('supabase/migrations/20260910182541_finance_movement_correction_foundation.sql','utf8'));
 const guards=readFileSync('supabase/migrations/20260910183506_finance_active_movement_financial_guards.sql','utf8');
 await run(guards.slice(0,guards.indexOf('create function finance_private.guard_active_financial_movement_reference()')));
 await run(`create or replace function finance_private.can_access(_tenant uuid) returns boolean language sql stable security definer set search_path='' as $$select auth.uid() is not null and nullif(current_setting('request.active_tenant',true),'')::uuid=_tenant and exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role in('owner','admin','operator')) and not exists(select 1 from public.tenant_memberships m where m.tenant_id=_tenant and m.user_id=auth.uid() and m.active and m.role='driver') and not exists(select 1 from public.drivers d where d.tenant_id=_tenant and d.user_id=auth.uid() and d.active)$$;`);
 await run(`insert into tenant_memberships(tenant_id,user_id,role,active) values(${q(ids.otherTenant)},${q(ids.operator)},'admin',true);begin;${migrationSql}commit;`);

 const auth=tenant=>`select set_config('request.jwt.claim.sub',${q(ids.operator)},false);select set_config('request.active_tenant',${q(tenant)},false);set role authenticated;`;
 const json=async sql=>JSON.parse((await run(sql)).split('\n').filter(Boolean).at(-1));
 const base=tenant=>({version:1,tenant_id:tenant,request_id:randomUUID(),reason:'Baixa agrupada conferida em disputa nativa do PostgreSQL'});
 const call=(name,payload)=>`${auth(payload.tenant_id)}select ${name}(${q(JSON.stringify(payload))}::jsonb);`;
 async function movement(tenant,account,amount=50000){
  return(await json(call('record_finance_movement',{...base(tenant),bank_account_id:account,direction:'out',nature:'payment',amount_cents:amount,occurred_on:'2026-01-15',description:'Pagamento agrupado',beneficiary_name:'Fornecedor QA',bank_reference:`PIX-LOTE-QA-${randomUUID()}`}))).movement_id;
 }
 async function payable(tenant,amount){return run(`insert into payables(tenant_id,supplier_name,category,description,amount,status) values(${q(tenant)},'Fornecedor QA','supplier','Documento conferido',${amount},'approved') returning id`);}
 async function fixture(tenant=ids.tenant,account=ids.account){
  await run(`update tenant_memberships set active=true where tenant_id=${q(tenant)} and user_id=${q(ids.operator)}`);
  const movementId=await movement(tenant,account),first=await payable(tenant,300),second=await payable(tenant,200);
  const items=[{payable_id:first,amount_cents:'30000'},{payable_id:second,amount_cents:'20000'}];
  const context=await json(`${auth(tenant)}select get_finance_payable_bulk_context(${q(tenant)},${q(movementId)},${q(JSON.stringify(items))}::jsonb);`);
  assert.equal(context.eligible,true,JSON.stringify(context.blockers));
  return{tenant,account,movement:movementId,first,second,items,command:{...base(tenant),movement_id:movementId,bank_account_id:account,paid_on:'2026-01-15',expected_revision:context.expected_revision,items,method:'pix'}};
 }
 const bulk=source=>call('apply_finance_payable_bulk_movement',source.command);
 const single=source=>call('apply_finance_payable_movement',{...base(source.tenant),movement_id:source.movement,payable_id:source.first,amount_cents:30000,method:'pix'});
 const race=(first,second,options={})=>contested(first,second,{database,driver:false,...options});
 async function counts(source){return JSON.parse(await run(`select json_build_object('payments',(select count(*) from payables_payments where tenant_id=${q(source.tenant)} and payable_id in(${q(source.first)},${q(source.second)})),'links',(select count(*) from finance_payable_movement_links where tenant_id=${q(source.tenant)} and movement_id=${q(source.movement)}),'commands',(select count(*) from finance_commands where tenant_id=${q(source.tenant)} and action='apply_payable_bulk_movement' and payload->>'movement_id'=${q(source.movement)}),'events',(select count(*) from finance_events where tenant_id=${q(source.tenant)} and action like 'payable_bulk%' and after_data->>'movement_id'=${q(source.movement)}))`));}
 let passed=0;const pass=label=>{console.log(`PASS ${label}`);passed++;};

 let source=await fixture(),before=await run(`select to_jsonb(m) from finance_movements m where id=${q(source.movement)}`),result=await race(bulk(source),bulk(source),{waitForBlocking:false,waiterSucceeds:false});
 assert.match(result.error,/40001[\s\S]*finance_movement_use_busy/);const replay=await json(bulk(source));assert.equal(replay.request_id,source.command.request_id);assert.deepEqual(await counts(source),{payments:2,links:2,commands:1,events:3});assert.equal(await run(`select to_jsonb(m) from finance_movements m where id=${q(source.movement)}`),before);assert.equal(await run('select count(*) from bank_transactions'),'0');
 pass('same request reports busy under overlap, then replays exactly one atomic batch');

 source=await fixture();const secondCommand={...source.command,request_id:randomUUID()};result=await race(bulk(source),call('apply_finance_payable_bulk_movement',secondCommand),{waitForBlocking:false,waiterSucceeds:false});assert.match(result.error,/finance_movement_use_busy/);await assert.rejects(()=>run(call('apply_finance_payable_bulk_movement',secondCommand)),/40001[\s\S]*finance_payable_bulk_changed/);assert.deepEqual(await counts(source),{payments:2,links:2,commands:1,events:3});assert.equal(await run(`select count(*) from finance_commands where request_id=${q(secondCommand.request_id)}`),'0');
 pass('distinct bulk request cannot settle the same titles after a concurrent winner');

 source=await fixture();result=await race(bulk(source),single(source),{waiterSucceeds:false});assert.match(result.error,/finance_payable_not_payable|finance_payable_overpaid/);assert.deepEqual(await counts(source),{payments:2,links:2,commands:1,events:3});
 pass('bulk winner prevents a queued single-title writer from duplicating payment');

 source=await fixture();result=await race(single(source),bulk(source),{waitForBlocking:false,waiterSucceeds:false});assert.match(result.error,/finance_movement_use_busy/);await assert.rejects(()=>run(bulk(source)),/40001[\s\S]*finance_payable_bulk_changed/);const afterSingle=await counts(source);assert.equal(afterSingle.payments,1);assert.equal(afterSingle.links,1);assert.equal(afterSingle.commands,0);assert.equal(afterSingle.events,0);
 pass('single-title winner leaves no partial rows from a rejected bulk retry');

 source=await fixture();result=await race(`select id from payables where tenant_id=${q(source.tenant)} and id=${q(source.first)} for update`,bulk(source),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where tenant_id=${q(source.tenant)} and user_id=${q(ids.operator)}`});assert.match(result.error,/42501[\s\S]*finance_access_denied/);assert.deepEqual(await counts(source),{payments:0,links:0,commands:0,events:0});await run(`update tenant_memberships set active=true where tenant_id=${q(source.tenant)} and user_id=${q(ids.operator)}`);
 pass('membership revoked while title locks wait prevents every batch side effect');

 source=await fixture(ids.otherTenant,ids.otherAccount);await race(`select pg_advisory_xact_lock(hashtextextended(${q(ids.tenant+':finance')},0))`,bulk(source),{waitForBlocking:false});assert.deepEqual(await counts(source),{payments:2,links:2,commands:1,events:3});
 pass('a tenant finance lock does not block another tenant bulk settlement');

 console.log(`CORE SHA256 ${migrationHash}`);return passed;
}
