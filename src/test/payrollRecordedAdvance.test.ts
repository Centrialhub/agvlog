// @vitest-environment node
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createPayrollRecordedAdvanceDatabase} from './helpers/payrollRecordedAdvanceDatabase';
import {financeIds as i,financeAs} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{db=await createPayrollRecordedAdvanceDatabase();},60000);afterAll(async()=>{await db?.close();});beforeEach(async()=>{await db.exec('begin');await db.query("select set_config('request.jwt.claim.sub',$1,true)",[i.operator]);await db.query("update tenant_memberships set role='admin' where tenant_id=$1 and user_id=$2",[i.tenant,i.operator]);});afterEach(async()=>{await db.exec('rollback');});
const command=()=>({version:1,tenant_id:i.tenant,request_id:randomUUID(),reason:'Recorded advance payroll integration'});
async function seed(){const employee=randomUUID();await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Payroll partial employee')",[employee,i.tenant]);await db.query("insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values($1,$2,'fixed','2026-01-01',1000)",[i.tenant,employee]);const advance=(await financeAs<{id:string}>(db,i.operator,"select public.register_employee_advance($1,$2,100,current_date,'Partial advance review','pix',null,true,false) id",[i.tenant,employee])).rows[0].id;const payable=(await db.query<{payable_id:string}>('select payable_id from employee_advances where id=$1',[advance])).rows[0].payable_id;await db.query("update payables set status='approved' where id=$1",[payable]);return{employee,advance,payable};}
async function pay(payable:string,amount:number){const occurredOn=(await db.query<{value:string}>("select (clock_timestamp() at time zone 'America/Sao_Paulo')::date::text value")).rows[0].value;const movement=(await financeAs<{v:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1) v',[{...command(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:amount,occurred_on:occurredOn,description:'Actual payroll advance delivery',beneficiary_name:'Payroll partial employee'}])).rows[0].v;return(await financeAs<{v:{link_id:string;movement_id:string;payment_id:string}}>(db,i.operator,'select apply_finance_payable_movement($1) v',[{...command(),movement_id:movement.movement_id,payable_id:payable,amount_cents:amount,method:'pix'}])).rows[0].v;}
async function generate(){return(await financeAs<{id:string}>(db,i.operator,"select generate_payroll_period($1,date_trunc('month',current_date)::date,(date_trunc('month',current_date)+interval '1 month -1 day')::date) id",[i.tenant])).rows[0].id;}
async function entry(period:string){return(await db.query<{id:string,already_paid_amount:string,amount_to_pay:string}>('select id,already_paid_amount,amount_to_pay from payroll_entries where payroll_period_id=$1',[period])).rows[0];}
it('deducts only delivered40, rejects stale approval after delivered60, preserves approved snapshot and blocks further source payment',async()=>{
 const s=await seed();const paidFirst=await pay(s.payable,4000);const period=await generate();const first=await entry(period);expect(Number(first.already_paid_amount)).toBe(40);expect(Number(first.amount_to_pay)).toBe(960);expect(await generate()).toBe(period);
 await pay(s.payable,2000);await db.exec('savepoint stale');await expect(financeAs(db,i.operator,'select approve_payroll_period($1)',[period])).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint stale');
 await financeAs(db,i.operator,'select recalculate_payroll_entry($1)',[first.id]);expect(Number((await entry(period)).already_paid_amount)).toBe(60);await financeAs(db,i.operator,'select approve_payroll_period($1)',[period]);
 const frozen=(await db.query('select to_jsonb(x) v from payroll_entry_items x where payroll_period_id=$1 order by id',[period])).rows;
 expect((await db.query<{amount:string}>("select amount from payables where source_table='payroll_entries' and source_id=$1",[first.id])).rows.map(x=>Number(x.amount))).toEqual([940]);
 await db.exec('savepoint materialized');await expect(pay(s.payable,2000)).rejects.toThrow('finance_advance_materialized_in_payroll');await db.exec('rollback to savepoint materialized');expect((await db.query('select to_jsonb(x) v from payroll_entry_items x where payroll_period_id=$1 order by id',[period])).rows).toEqual(frozen);
 await db.exec('savepoint reverse_protected');await expect(financeAs(db,i.operator,'select reverse_finance_payable_link($1)',[{...command(),link_id:paidFirst.link_id}])).rejects.toThrow('finance_advance_materialized_in_payroll');await db.exec('rollback to savepoint reverse_protected');
 for(const [sql,parameters] of [
  ["update employee_advances set reason='Late source rewrite' where id=$1",[s.advance]],
  ["update payables set description='Late title rewrite' where id=$1",[s.payable]],
  ["update finance_movements set description='Late movement rewrite' where id=$1",[paidFirst.movement_id]],
  ['delete from payables_payments where id=$1',[paidFirst.payment_id]],
 ] as const){await db.exec('savepoint mutation_protected');await expect(db.query(sql,[...parameters])).rejects.toThrow('finance_advance_materialized_in_payroll');await db.exec('rollback to savepoint mutation_protected');}
 const item=(await db.query<{id:string}>("select id from payroll_entry_items where payroll_period_id=$1 and source_table='employee_advances'",[period])).rows[0].id;expect((await db.query<{v:{valid:boolean}}>('select finance_private.paid_projection_chain($1,$2,$3) v',[i.tenant,'payroll_entry_items',item])).rows[0].v.valid).toBe(true);
});


it('requires explicit recalculation when an initially unpaid advance is delivered, and when its real allocation is reversed',async()=>{
 const s=await seed();const period=await generate(),initial=await entry(period);expect(Number(initial.already_paid_amount)).toBe(0);
 const paid=await pay(s.payable,4000);await db.exec('savepoint newly_paid');await expect(financeAs(db,i.operator,'select approve_payroll_period($1)',[period])).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint newly_paid');
 await financeAs(db,i.operator,'select recalculate_payroll_entry($1)',[initial.id]);expect(Number((await entry(period)).already_paid_amount)).toBe(40);
 const money=(await db.query('select to_jsonb(x) v from finance_movements x order by id')).rows;
 await financeAs(db,i.operator,'select reverse_finance_payable_link($1)',[{...command(),link_id:paid.link_id}]);
 await db.exec('savepoint reversed');await expect(financeAs(db,i.operator,'select approve_payroll_period($1)',[period])).rejects.toMatchObject({code:'40001'});await db.exec('rollback to savepoint reversed');
 await financeAs(db,i.operator,'select recalculate_payroll_entry($1)',[initial.id]);expect(Number((await entry(period)).already_paid_amount)).toBe(0);expect(Number((await entry(period)).amount_to_pay)).toBe(1000);expect((await db.query('select to_jsonb(x) v from finance_movements x order by id')).rows).toEqual(money);
});

it('blocks a late delivery after an unpaid advance period was approved without an already-paid item',async()=>{
 const s=await seed();const period=await generate(),approvedEntry=await entry(period);expect(Number(approvedEntry.already_paid_amount)).toBe(0);
 await financeAs(db,i.operator,'select approve_payroll_period($1)',[period]);
 await db.exec('savepoint late_delivery');await expect(pay(s.payable,4000)).rejects.toThrow('finance_advance_materialized_in_payroll');await db.exec('rollback to savepoint late_delivery');
 await db.exec('savepoint late_change');await expect(db.query("update employee_advances set reason='Late approved-period rewrite' where id=$1",[s.advance])).rejects.toThrow('finance_advance_materialized_in_payroll');await db.exec('rollback to savepoint late_change');
 expect((await db.query<{n:number}>('select count(*)::int n from payables_payments where payable_id=$1',[s.payable])).rows[0].n).toBe(0);
});
