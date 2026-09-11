import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runSettlementPaymentNative({query,contested,literal:q,createRoles=false}){
 const database='finance_settlement_payment_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['employees','employee_contracts','employee_advances','employee_incident_actions','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','driver_settlement_events','payroll_periods','payroll_entries','payroll_entry_items','payroll_generation_issues','payables','payables_payments']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);
  await run(`alter table ${table} add primary key(id)`);
 }
 await run(`alter table payroll_entries add unique(payroll_period_id,employee_id),add foreign key(payroll_period_id) references payroll_periods(id);
 alter table payroll_entry_items add foreign key(payroll_period_id) references payroll_periods(id),add foreign key(payroll_entry_id) references payroll_entries(id);
 create unique index qa_payroll_source on payables(tenant_id,source_table,source_id,category) where source_table is not null and source_id is not null;
 create table finance_expense_items(id uuid,tenant_id uuid,unique(tenant_id,id));create table bank_transactions(id uuid primary key);
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql stable as $$select finance_private.can_access($1)$$;
 create function finance_private.require_access(uuid) returns void language plpgsql as $$begin if not finance_private.can_access($1) then raise exception 'finance_access_denied';end if;end$$;`);
 for(const [file,table] of [['20260909213959_finance_expense_batches.sql','finance_expense_allocations'],['20260910002244_finance_payable_movement_links.sql','finance_payable_movement_links'],['20260910003529_finance_payable_link_reversal.sql','finance_payable_link_reversals']]){
  const source=readFileSync('supabase/migrations/'+file,'utf8'),create=source.match(new RegExp(`create table public\\.${table}\\s*\\([\\s\\S]*?\\);`))?.[0];assert.ok(create,table);await run(create);
 }
 await run('create view finance_private.active_payable_payments as select p.* from payables_payments p where not exists(select 1 from finance_payable_movement_links l join finance_payable_link_reversals r on r.link_id=l.id where l.payment_id=p.id)');
 for(const name of ['_log_settlement_event','register_driver_settlement_payment','register_driver_settlement_payment_v2','recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item','enforce_payroll_items_locked']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];assert.ok(fn,name);await run(fn);
 }
 await run('create trigger trg_payroll_items_locked before insert or update or delete on payroll_entry_items for each row execute function enforce_payroll_items_locked();');
 for(const file of ['20260910000731_finance_payroll_payment_projection.sql','20260910130540_finance_settlement_movement_links.sql','20260910132406_finance_payroll_reimbursement_source_dedup.sql','20260910133352_finance_payroll_lifecycle_serialization.sql','20260910133355_finance_new_settlement_payment_candidates.sql','20260910133421_finance_settlement_payment_recording.sql','20260910133700_finance_retire_legacy_settlement_payment_writers.sql']){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');await run('begin;'+sql+'commit;');console.log('Settlement payment candidate '+file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 }
 const auth=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`,race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 const record=p=>`${auth}select record_finance_settlement_payment(${q(JSON.stringify(p))}::jsonb);set constraints all immediate`;
 let month=0;
 async function fixture(){
  await run(`update tenant_memberships set active=true where user_id=${q(i.operator)};update employees set status='inactive';`);
  const employee=randomUUID(),settlement=randomUUID(),from=`2025-${String(++month).padStart(2,'0')}-01`,to=`2025-${String(month).padStart(2,'0')}-28`,date=`2025-${String(month).padStart(2,'0')}-10`;
  await run(`insert into employees(id,tenant_id,driver_id,name) values(${q(employee)},${q(i.tenant)},${q(i.driver)},'Motorista QA');insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values(${q(i.tenant)},${q(employee)},'fixed','2025-01-01',1000);
   insert into driver_settlements(id,tenant_id,driver_id,status,driver_payable_amount,driver_reimbursement_total,trip_completed_at) values(${q(settlement)},${q(i.tenant)},${q(i.driver)},'approved',500,0,${q(date+'T12:00:00Z')});`);
  const movement=JSON.parse(await run(`${auth}select record_finance_movement(${q(JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',driver_id:i.driver,amount_cents:50000,occurred_on:date,description:'Envio motorista',beneficiary_name:'Motorista QA',reason:'Envio efetuado e conferido'}))}::jsonb)`)).movement_id;
  const generate=`${auth}select generate_payroll_period(${q(i.tenant)},${q(from)},${q(to)})`,period=await run(generate),entry=await run(`select id from payroll_entries where payroll_period_id=${q(period)} and employee_id=${q(employee)}`);
  return {employee,settlement,movement,date,generate,period,entry,approve:`${auth}select approve_payroll_period(${q(period)})`,money:await run(`select to_jsonb(m) from finance_movements m where id=${q(movement)}`),moneyCount:await run('select count(*) from finance_movements'),payload:{version:1,tenant_id:i.tenant,request_id:randomUUID(),settlement_id:settlement,movement_id:movement,amount_cents:30000,method:'pix',reason:'Pagamento efetuado e conferido pelo financeiro QA'}};
 }
 async function check(f,{payments=1,paid=300,toPay=1200,status='calculated'}={}){
  assert.equal(await run(`select to_jsonb(m) from finance_movements m where id=${q(f.movement)}`),f.money);assert.equal(await run('select count(*) from finance_movements'),f.moneyCount);
  assert.equal(await run(`select count(*) from driver_settlement_payments where settlement_id=${q(f.settlement)}`),String(payments));
  assert.equal(await run(`select count(*) from finance_settlement_movement_links where movement_id=${q(f.movement)}`),String(payments));
  assert.equal(await run(`select count(*) from payroll_entry_items where payroll_entry_id=${q(f.entry)} and item_type='driver_settlement_payment'`),String(payments));
  assert.equal(await run(`select already_paid_amount::numeric(14,2) from payroll_entries where id=${q(f.entry)}`),`${paid}.00`);
  assert.equal(await run(`select amount_to_pay::numeric(14,2) from payroll_entries where id=${q(f.entry)}`),`${toPay}.00`);
  assert.equal(await run(`select status from payroll_periods where id=${q(f.period)}`),status);
  assert.equal(await run('select count(*) from bank_transactions'),'0');assert.equal(await run('select count(*) from finance_expense_items'),'0');
 }
 const tests=[
  ['same request replays one canonical payment, cash link and payroll already-paid row',async()=>{
   const f=await fixture(),r=await race(record(f.payload),record(f.payload));const first=JSON.parse(r.output.trim().split('\n').at(-1)),replay=JSON.parse(await run('begin;'+record(f.payload)+';commit'));
   assert.deepEqual(replay,first);assert.equal(replay.cash_created,false);await check(f);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'1');
  }],
  ['two different requests cannot exceed the actual settlement debt',async()=>{
   const f=await fixture(),second={...f.payload,request_id:randomUUID()},r=await race(record(f.payload),record(second),{waiterSucceeds:false});assert.match(r.error,/finance_settlement_overpaid/);await check(f);assert.equal(await run(`select count(*) from finance_commands where request_id=${q(second.request_id)}`),'0');
  }],
  ['two settlements cannot consume more than one recorded outgoing capacity',async()=>{
   const f=await fixture(),second=randomUUID();await run(`insert into driver_settlements(id,tenant_id,driver_id,status,driver_payable_amount,driver_reimbursement_total,trip_completed_at) values(${q(second)},${q(i.tenant)},${q(i.driver)},'approved',500,0,${q(f.date+'T12:00:00Z')})`);
   const r=await race(record(f.payload),record({...f.payload,request_id:randomUUID(),settlement_id:second}),{waiterSucceeds:false});assert.match(r.error,/finance_movement_overallocated/);await check(f);assert.equal(await run(`select count(*) from driver_settlement_payments where settlement_id=${q(second)}`),'0');
  }],
  ['payment first and generation waiting rebuild the same source once',async()=>{const f=await fixture();await race(record(f.payload),f.generate);await check(f);}],
  ['generation first and payment waiting append to the committed payroll',async()=>{const f=await fixture();await race(f.generate,record(f.payload));await check(f);}],
  ['payment first and approval waiting use reduced amount-to-pay exactly once',async()=>{const f=await fixture();await race(record(f.payload),f.approve);await check(f,{status:'approved'});assert.equal(await run(`select amount::numeric(14,2) from payables where source_id=${q(f.entry)}`),'1200.00');}],
  ['approval first blocks queued payment without partial payment, link or payroll writes',async()=>{const f=await fixture(),r=await race(f.approve,record(f.payload),{waiterSucceeds:false});assert.match(r.error,/finance_settlement_locked_in_payroll/);await check(f,{payments:0,paid:0,toPay:1500,status:'approved'});assert.equal(await run(`select amount::numeric(14,2) from payables where source_id=${q(f.entry)}`),'1500.00');}],
  ['access revoked while recording waits prevents every payment side effect',async()=>{const f=await fixture(),r=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,record(f.payload),{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});assert.match(r.error,/finance_access_denied/);await check(f,{payments:0,paid:0,toPay:1500});assert.equal(await run(`select count(*) from finance_commands where request_id=${q(f.payload.request_id)}`),'0');}],
  ['deferred cutoff rejects a privileged unlinked payment at constraint flush',async()=>{const f=await fixture();await assert.rejects(()=>run(`begin;set request.jwt.claim.sub=${q(i.operator)};insert into driver_settlement_payments(tenant_id,settlement_id,amount,paid_at) values(${q(i.tenant)},${q(f.settlement)},10,${q(f.date+'T15:00:00Z')});set constraints all immediate;commit`),/finance_settlement_payment_requires_recorded_movement/);await check(f,{payments:0,paid:0,toPay:1500});}],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
