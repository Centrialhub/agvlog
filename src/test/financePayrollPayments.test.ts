// @vitest-environment node
import {readFileSync} from 'node:fs';
import type {PGlite} from '@electric-sql/pglite';
import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it} from 'vitest';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {payrollProjectionSchema,payrollPeriodsProjectionSchema} from '../lib/financial/payrollPaymentContract';

let db:PGlite;
const period='50000000-0000-4000-8000-000000000001';
const employee='50000000-0000-4000-8000-000000000002';
const entry='50000000-0000-4000-8000-000000000003';
const title='50000000-0000-4000-8000-000000000004';
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`create table payroll_periods(id uuid primary key,tenant_id uuid,status text default 'approved',period_start date default current_date,
 closed_by uuid,closed_at timestamptz,notes text,updated_at timestamptz);
 create table employees(id uuid primary key,tenant_id uuid,name text,doc_cpf text,branch text,department text);
 create table payroll_entries(id uuid primary key,tenant_id uuid,payroll_period_id uuid,employee_id uuid,
 status text,amount_to_pay numeric(14,2),already_paid_amount numeric(14,2),gross_amount numeric(14,2),discount_amount numeric(14,2),created_at timestamptz default now());
 create table payables(id uuid primary key default gen_random_uuid(),tenant_id uuid,source_table text,source_id uuid,category text,amount numeric(14,2),status text);
 create table payables_payments(id uuid primary key default gen_random_uuid(),tenant_id uuid,payable_id uuid,amount numeric);`);
 await db.query('insert into payroll_periods(id,tenant_id) values($1,$2)',[period,i.tenant]);
 await db.query("insert into employees(id,tenant_id,name) values($1,$2,'Funcionário QA')",[employee,i.tenant]);
 await db.query("insert into payroll_entries(id,tenant_id,payroll_period_id,employee_id,status,amount_to_pay,already_paid_amount,gross_amount,discount_amount) values($1,$2,$3,$4,'approved',800,200,1000,0)",[entry,i.tenant,period,employee]);
 await db.query("insert into payables values($1,$2,'payroll_entries',$3,'payroll',800,'approved')",[title,i.tenant,entry]);
 await db.exec(`create function public.is_tenant_admin(t uuid) returns boolean language sql as
 $$select exists(select 1 from tenant_memberships where tenant_id=t and user_id=auth.uid() and role in ('admin','owner') and active)$$;`);
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 const close=baseline.match(/CREATE OR REPLACE FUNCTION public.close_payroll_period\([\s\S]*?\$function\$;/)?.[0];
 if(!close)throw new Error('Missing baseline payroll close function');
 await db.exec(close);
 await db.exec('grant execute on function close_payroll_period(uuid,text) to authenticated');
 await db.exec(readFileSync('supabase/migrations/20260909235237_finance_legacy_rpc_boundary.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910000731_finance_payroll_payment_projection.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
async function read(){
 const reply=await financeAs<{result:unknown}>(db,i.operator,'select get_finance_payroll_entries($1,$2) result',[i.tenant,period]);
 return payrollProjectionSchema.parse(reply.rows[0].result).rows[0];
}
async function pay(amount:string,tenant=i.tenant){await db.query('insert into payables_payments(tenant_id,payable_id,amount) values($1,$2,$3)',[tenant,title,amount]);}
describe('payroll obligation and registered payments',()=>{
 it('closes using the actual remaining balance and blocks unresolved payment inconsistencies',async()=>{
  await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,i.operator]);
  await pay('300');
  await expect(financeAs(db,i.operator,'select close_payroll_period($1)',[period])).rejects.toThrow('saldo em aberto (500.00)');
  await pay('500');
  await financeAs(db,i.operator,'select close_payroll_period($1)',[period]);
  expect((await db.query<{status:string}>('select status from payroll_periods')).rows[0].status).toBe('closed');
  await db.exec("update payroll_periods set status='approved'");
  await pay('1');
  await expect(financeAs(db,i.operator,"select close_payroll_period($1,'Justificativa')",[period])).rejects.toThrow('finance_payroll_payment_review_required');
 });
 it('derives period status from the same obligation payments and preserves a cancelled paid exception',async()=>{
  async function readPeriod(){
   const reply=await financeAs<{result:unknown}>(db,i.operator,'select get_finance_payroll_periods($1,$2) result',[i.tenant,period]);
   return payrollPeriodsProjectionSchema.parse(reply.rows[0].result).rows[0];
  }
  expect(await readPeriod()).toMatchObject({payment_status:'partial',remaining_amount:'800.00',payment_issues_count:0});
  await pay('800');
  expect(await readPeriod()).toMatchObject({payment_status:'paid',remaining_amount:'0.00'});
  await db.exec("update payroll_periods set status='cancelled'");
  expect(await readPeriod()).toMatchObject({payment_status:'review',payment_issues_count:1});
 });
 it('keeps earlier advances separate, reflects partial/full payment and reversal without generating money',async()=>{
  expect((await read()).payment_summary).toMatchObject({remaining_amount:'800.00',paid_via_titles:'0',status:'partial'});
  await pay('300.00');
  expect(await read()).toMatchObject({amount_to_pay:800,already_paid_amount:200,payment_summary:{paid_via_titles:'300.00',remaining_amount:'500.00',status:'partial',issues:[],bank_confirmation:'not_evaluated'}});
  await pay('500.00');
  expect((await read()).payment_summary).toMatchObject({remaining_amount:'0.00',status:'paid'});
  await db.exec('delete from payables_payments where amount=500');
  expect((await read()).payment_summary).toMatchObject({remaining_amount:'500.00',status:'partial'});
  expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
  expect((await db.query('select * from payables')).rows).toHaveLength(1);
 });
 it('does not turn missing titles, cancelled obligations or excess payment into a clean paid status',async()=>{
  await db.exec('delete from payables');
  expect((await read()).payment_summary).toMatchObject({status:'review',issues:['missing_title']});
  await db.query("insert into payables values($1,$2,'payroll_entries',$3,'payroll',800,'cancelled')",[title,i.tenant,entry]);
  await pay('900');
  expect((await read()).payment_summary).toMatchObject({status:'review',overpaid_amount:'100.00',issues:['title_amount_mismatch','cancelled_title','overpaid']});
 });
 it('detects duplicate titles and fractional-cent data instead of silently rounding it',async()=>{
  await db.query("insert into payables(tenant_id,source_table,source_id,category,amount,status) values($1,'payroll_entries',$2,'payroll',800,'approved')",[i.tenant,entry]);
  await pay('0.001');
  expect((await read()).payment_summary.issues).toEqual(['multiple_titles','title_amount_mismatch','invalid_payment_amount']);
 });
 it('isolates tenants and denies driver access, including mixed internal/driver profiles',async()=>{
  await pay('800',i.otherTenant);
  expect((await read()).payment_summary.paid_via_titles).toBe('0');
  await expect(financeAs(db,i.operator,'select get_finance_payroll_entries($1,$2)',[i.otherTenant,period])).rejects.toThrow('finance_access_denied');
  await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,i.driverUser]);
  await expect(financeAs(db,i.driverUser,'select get_finance_payroll_entries($1,$2)',[i.tenant,period])).rejects.toThrow('finance_access_denied');
 });
});
