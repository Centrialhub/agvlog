import assert from 'node:assert/strict';
import {randomUUID,createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';
import {prepareFinanceLedgerDatabase,financeIds as i} from '../src/test/helpers/financeLedgerDatabase.ts';
export async function runPayrollLifecycleNative({query,contested,literal:q,createRoles=false}){
 const database='finance_payroll_lifecycle_qa';await query(`create database ${database}`);const run=sql=>query(sql,database);
 await prepareFinanceLedgerDatabase({exec:run,query:(sql,params=[])=>run(sql.replace(/\$(\d+)/g,(_,n)=>q(params[Number(n)-1])))},createRoles);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['employees','employee_contracts','employee_advances','employee_incident_actions','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','payroll_periods','payroll_entries','payroll_entry_items','payroll_generation_issues','payables','payables_payments']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];assert.ok(create,table);await run(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await run(defaults);
  await run(`alter table ${table} add primary key(id)`);
 }
 await run(`alter table payroll_entries add unique(payroll_period_id,employee_id),add foreign key(payroll_period_id) references payroll_periods(id);
 alter table payroll_entry_items add foreign key(payroll_period_id) references payroll_periods(id),add foreign key(payroll_entry_id) references payroll_entries(id);
 create unique index qa_payroll_source on payables(tenant_id,source_table,source_id,category) where source_table is not null and source_id is not null;
 create view finance_private.active_payable_payments as select * from payables_payments;
 create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select finance_private.can_access($1)$$;
 create function public.is_tenant_admin(uuid) returns boolean language sql stable as $$select finance_private.can_access($1)$$;
 create function finance_private.require_access(uuid) returns void language plpgsql as $$begin if not finance_private.can_access($1) then raise exception 'finance_access_denied';end if;end$$;`);
 for(const name of ['recompute_payroll_entry_totals','generate_payroll_period','approve_payroll_period','close_payroll_period','recalculate_payroll_entry','add_payroll_manual_item','delete_payroll_entry_item','enforce_payroll_items_locked']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];assert.ok(fn,name);await run(fn);
 }
 await run('create trigger trg_payroll_items_locked before insert or update or delete on payroll_entry_items for each row execute function enforce_payroll_items_locked();grant select,insert,update,delete on payroll_entries,payroll_periods,payroll_entry_items to authenticated');
 for(const file of ['20260910000731_finance_payroll_payment_projection.sql','20260910132406_finance_payroll_reimbursement_source_dedup.sql','20260910133352_finance_payroll_lifecycle_serialization.sql']){
  const sql=readFileSync('supabase/migrations/'+file,'utf8');await run('begin;'+sql+'commit;');console.log('Payroll candidate '+file+' SHA256 '+createHash('sha256').update(sql).digest('hex'));
 }
 const auth=`set request.jwt.claim.sub=${q(i.operator)};set role authenticated;`,race=(a,b,opts={})=>contested(a,b,{database,driver:false,...opts});
 let month=0;
 async function fixture(){
  await run(`update tenant_memberships set active=true where user_id=${q(i.operator)};update employees set status='inactive';`);
  const employee=randomUUID(),from=`2025-${String(++month).padStart(2,'0')}-01`,to=`2025-${String(month).padStart(2,'0')}-28`;
  await run(`insert into employees(id,tenant_id,name) values(${q(employee)},${q(i.tenant)},'Funcionário QA');insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values(${q(i.tenant)},${q(employee)},'fixed','2025-01-01',1000);`);
  const generate=`${auth}select generate_payroll_period(${q(i.tenant)},${q(from)},${q(to)})`,period=await run(generate),entry=await run(`select id from payroll_entries where payroll_period_id=${q(period)}`);
  return {period,entry,generate,approve:`${auth}select approve_payroll_period(${q(period)})`,manual:`${auth}select add_payroll_manual_item(${q(entry)},'credit','Ajuste QA',100,'Ajuste conferido QA')`,recompute:`${auth}select recompute_payroll_entry_totals(${q(entry)})`};
 }
 async function check(f,amount,status='approved'){
  assert.equal(await run(`select status from payroll_periods where id=${q(f.period)}`),status);
  assert.equal(await run(`select amount_to_pay::numeric(14,2) from payroll_entries where id=${q(f.entry)}`),`${amount}.00`);
  if(status==='approved')assert.equal(await run(`select amount::numeric(14,2) from payables where source_table='payroll_entries' and source_id=${q(f.entry)}`),`${amount}.00`);
  assert.equal(await run('select count(*) from finance_movements'),'0');assert.equal(await run('select count(*) from driver_settlement_payments'),'0');
 }
 const tests=[
  ['generation holding payroll locks lets approval wait and calculate the committed version',async()=>{const f=await fixture();await race(f.generate,f.approve);await check(f,1000);}],
  ['approval first prevents queued generation from overwriting a protected payroll',async()=>{const f=await fixture();const r=await race(f.approve,f.generate,{waiterSucceeds:false});assert.match(r.error,/finance_payroll_generation_locked/);await check(f,1000);}],
  ['manual credit before approval is included once in the approved payable',async()=>{const f=await fixture();await race(f.manual,f.approve);await check(f,1100);}],
  ['manual credit after concurrent approval is rejected without changing totals or payable',async()=>{const f=await fixture();const r=await race(f.approve,f.manual,{waiterSucceeds:false});assert.match(r.error,/finance_payroll_period_protected/);await check(f,1000);}],
  ['direct recomputation queued after approval cannot change the approved entry',async()=>{const f=await fixture();const r=await race(f.approve,f.recompute,{waiterSucceeds:false});assert.match(r.error,/finance_payroll_period_protected/);await check(f,1000);}],
  ['recomputation then approval share lock order without entry-period deadlock',async()=>{const f=await fixture();await race(f.recompute,f.approve);await check(f,1000);}],
  ['access revoked while approval waits rejects all approval writes',async()=>{const f=await fixture();const r=await race(`select pg_advisory_xact_lock(hashtextextended(${q(i.tenant+':finance')},0))`,f.approve,{waiterSucceeds:false,holderAfterBlocked:`update tenant_memberships set active=false where user_id=${q(i.operator)}`});assert.match(r.error,/finance_access_denied/);await check(f,1000,'calculated');assert.equal(await run(`select count(*) from payables where source_id=${q(f.entry)}`),'0');}],
  ['browser table writes are revoked and privileged edits cannot alter approved totals',async()=>{
   const f=await fixture();await run(f.approve);
   for(const table of ['payroll_periods','payroll_entries','payroll_entry_items'])for(const verb of ['insert','update','delete'])assert.equal(await run(`select has_table_privilege('authenticated',${q(table)},${q(verb)})`),'f');
   await assert.rejects(()=>run(`set request.jwt.claim.sub=${q(i.operator)};update payroll_entries set amount_to_pay=1 where id=${q(f.entry)}`),/finance_payroll_period_protected/);await check(f,1000);
  }],
  ['approval ignores a cancelled entry without recomputing or locking its items',async()=>{
   const f=await fixture(),employee=randomUUID(),entry=randomUUID();
   await run(`set request.jwt.claim.sub=${q(i.operator)};insert into employees(id,tenant_id,name) values(${q(employee)},${q(i.tenant)},'Cancelado QA');insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,status) values(${q(entry)},${q(i.tenant)},${q(f.period)},${q(employee)},'cancelled');`);
   await run(f.approve);await check(f,1000);assert.equal(await run(`select status from payroll_entries where id=${q(entry)}`),'cancelled');
  }],
 ];
 for(const [name,test] of tests){await test();console.log('PASS '+name);}return tests.length;
}
