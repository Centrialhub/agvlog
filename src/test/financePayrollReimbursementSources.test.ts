// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
const migration='20260910132406_finance_payroll_reimbursement_source_dedup.sql';
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 for(const table of ['employees','employee_contracts','employee_advances','employee_incident_actions','driver_expenses','driver_settlements','driver_settlement_items','driver_settlement_payments','payroll_periods','payroll_entries','payroll_entry_items','payroll_generation_issues']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);
  await db.exec(`alter table ${table} add primary key(id)`);
 }
 await db.exec('alter table payroll_entries add unique(payroll_period_id,employee_id);create table payables(id uuid primary key,tenant_id uuid,source_table text,source_id uuid);create table payables_payments(id uuid primary key,tenant_id uuid,payable_id uuid,amount numeric);create view finance_private.active_payable_payments as select * from payables_payments;');
 await db.exec("create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql stable as $$select finance_private.can_access($1)$$;create function finance_private.require_access(uuid) returns void language plpgsql as $$begin if not finance_private.can_access($1) then raise exception 'finance_access_denied';end if;end$$;");
 for(const name of ['recompute_payroll_entry_totals','generate_payroll_period']){
  const fn=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!fn)throw new Error(name);await db.exec(fn);
 }
 await db.exec(readFileSync('supabase/migrations/'+migration,'utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
async function fixture(){
 const employee=randomUUID(),settlement=randomUUID(),covered=randomUUID(),outside=randomUUID(),payment=randomUUID(),advance=randomUUID();
 await db.query("insert into employees(id,tenant_id,driver_id,name) values($1,$2,$3,'Motorista QA')",[employee,i.tenant,i.driver]);
 await db.query("insert into employee_contracts(tenant_id,employee_id,contract_type,start_date,base_salary) values($1,$2,'fixed','2026-01-01',1000)",[i.tenant,employee]);
 await db.query("insert into driver_settlements(id,tenant_id,driver_id,status,trip_completed_at,driver_payable_amount,driver_reimbursement_total) values($1,$2,$3,'approved','2026-01-20T12:00:00Z',400,300)",[settlement,i.tenant,i.driver]);
 await db.query("insert into driver_expenses(id,tenant_id,driver_id,category,amount,expense_at,approval_status,reimbursable) values($1,$3,$4,'food',300,'2026-01-19T12:00:00Z','approved',true),($2,$3,$4,'food',70,'2026-01-22T12:00:00Z','approved',true)",[covered,outside,i.tenant,i.driver]);
 await db.query("insert into driver_settlement_items(tenant_id,settlement_id,item_type,source_table,source_id,description,amount,metadata) values($1,$2,'expense','driver_expenses',$3,'Reembolso de viagem',300,'{\"approval_status\":\"approved\",\"reimbursable\":true}')",[i.tenant,settlement,covered]);
 await db.query("insert into driver_settlement_payments(id,tenant_id,settlement_id,amount,paid_at) values($1,$2,$3,150,'2026-01-23T12:00:00Z')",[payment,i.tenant,settlement]);
 await db.query("insert into employee_advances(id,tenant_id,employee_id,driver_id,amount,advance_date,status) values($1,$2,$3,$4,100,'2026-01-02','paid')",[advance,i.tenant,employee,i.driver]);
 return {employee,settlement,covered,outside,payment,advance};
}
async function generate(from='2026-01-01',to='2026-01-31',actor=i.operator){return (await financeAs<{id:string}>(db,actor,'select generate_payroll_period($1,$2::date,$3::date) id',[i.tenant,from,to])).rows[0].id;}
async function snapshot(){return (await db.query("select jsonb_build_object('periods',(select jsonb_agg(to_jsonb(x) order by id) from payroll_periods x),'entries',(select jsonb_agg(to_jsonb(x) order by id) from payroll_entries x),'items',(select jsonb_agg(to_jsonb(x) order by id) from payroll_entry_items x),'payments',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlement_payments x),'advances',(select jsonb_agg(to_jsonb(x) order by id) from employee_advances x)) data")).rows[0];}
it('keeps remuneration, standalone expense and distinct already-paid sources while removing exact duplicated reimbursement',async()=>{
 const f=await fixture(),period=await generate();
 const items=(await db.query<{item_type:string;source_id:string;amount:string;source_metadata:unknown}>('select * from payroll_entry_items where payroll_period_id=$1',[period])).rows;
 expect(items.map(x=>x.item_type).sort()).toEqual(['base_salary','driver_advance','driver_expense_reimbursement','driver_settlement','driver_settlement_payment'].sort());
 expect(items.find(x=>x.item_type==='driver_expense_reimbursement')?.source_id).toBe(f.outside);
 expect(items.find(x=>x.item_type==='driver_settlement')?.source_metadata).toMatchObject({reimbursement_sources:[{expense_id:f.covered,amount:300}],reimbursement_dedup_version:1});
 expect(items.find(x=>x.item_type==='driver_settlement_payment')?.source_id).toBe(f.payment);expect(items.find(x=>x.item_type==='driver_advance')?.source_id).toBe(f.advance);
 const totals=(await db.query<{gross_amount:string;already_paid_amount:string;amount_to_pay:string}>('select * from payroll_entries where payroll_period_id=$1',[period])).rows[0];
 expect([totals.gross_amount,totals.already_paid_amount,totals.amount_to_pay].map(Number)).toEqual([1470,250,1220]);
 expect(await generate()).toBe(period);expect((await db.query('select * from payroll_entry_items')).rows).toHaveLength(5);
 expect((await db.query('select * from driver_settlement_payments')).rows).toHaveLength(1);expect((await db.query('select * from employee_advances')).rows).toHaveLength(1);
});
it('does not match unrelated expenses by equal amount',async()=>{
 const f=await fixture();await db.query('update driver_expenses set amount=300 where id=$1',[f.outside]);await generate();
 expect(Number((await db.query<{gross_amount:string}>('select gross_amount from payroll_entries')).rows[0].gross_amount)).toBe(1700);
});
it.each(['approved','closed','under_review'])('preserves existing %s payroll and rejects another generation for the same dates',async(status)=>{
 await fixture();const period=await generate();await db.query('update payroll_periods set status=$1 where id=$2',[status,period]);await db.exec("update payroll_entries set status='approved'");const before=await snapshot();
 await expect(generate()).rejects.toThrow('finance_payroll_generation_locked');expect(await snapshot()).toEqual(before);
});
it('blocks cross-period settlement reimbursement already credited by exact expense ID',async()=>{
 const f=await fixture();await db.query("update driver_settlements set trip_completed_at='2026-02-20T12:00:00Z' where id=$1",[f.settlement]);
 const old=await generate();await db.query("update payroll_periods set status='approved' where id=$1",[old]);await db.exec("update payroll_entries set status='approved'");const before=await snapshot();
 await expect(generate('2026-02-01','2026-02-28')).rejects.toThrow('finance_payroll_reimbursement_already_claimed');expect(await snapshot()).toEqual(before);
});
it('blocks a later standalone reimbursement already covered by a settlement snapshot',async()=>{
 const f=await fixture();await db.query("update driver_expenses set expense_at='2026-02-20T12:00:00Z' where id=$1",[f.covered]);const old=await generate();await db.query("update payroll_periods set status='closed' where id=$1",[old]);await db.exec("update payroll_entries set status='locked'");const before=await snapshot();
 await expect(generate('2026-02-01','2026-02-28')).rejects.toThrow('finance_payroll_reimbursement_already_claimed');expect(await snapshot()).toEqual(before);
});
it('cancelled payroll credits do not reserve reimbursement sources forever',async()=>{
 await fixture();const old=await generate();await db.query("update payroll_periods set status='cancelled' where id=$1",[old]);const original=(await db.query('select * from payroll_entry_items where payroll_period_id=$1 order by id',[old])).rows;
 const replacement=await generate();expect(replacement).not.toBe(old);expect((await db.query('select * from payroll_entry_items where payroll_period_id=$1 order by id',[old])).rows).toEqual(original);
});
it('missing source IDs or inconsistent source totals abort the entire generation',async()=>{
 await fixture();await db.exec("update driver_settlement_items set source_id=null");const before=await snapshot();await expect(generate()).rejects.toThrow('finance_payroll_reimbursement_source_review');expect(await snapshot()).toEqual(before);
});
it('drivers cannot generate payroll through the financial generator',async()=>{await fixture();await expect(generate('2026-01-01','2026-01-31',i.driverUser)).rejects.toThrow();expect((await db.query('select * from payroll_periods')).rows).toHaveLength(0);});

it('cancelled payroll with a recorded title payment requires review before a replacement',async()=>{
 await fixture();const old=await generate();await db.query("update payroll_periods set status='cancelled' where id=$1",[old]);
 await db.query("insert into payables select gen_random_uuid(),tenant_id,'payroll_entries',id from payroll_entries where payroll_period_id=$1",[old]);
 await db.exec('insert into payables_payments select gen_random_uuid(),tenant_id,id,100 from payables');const original=await snapshot();
 await expect(generate()).rejects.toThrow('finance_payroll_cancelled_payment_review');expect(await snapshot()).toEqual(original);expect((await db.query('select * from payables_payments')).rows).toHaveLength(1);
});

it.each(['approved','locked','closed'])('preserves a %s entry even when its period remains calculated',async(status)=>{
 await fixture();await generate();await db.query('update payroll_entries set status=$1',[status]);const original=await snapshot();await expect(generate()).rejects.toThrow('finance_payroll_generation_locked');expect(await snapshot()).toEqual(original);
});
it('uses frozen coverage after settlement source rows have changed',async()=>{
 const f=await fixture();await db.query("update driver_expenses set expense_at='2026-02-20T12:00:00Z' where id=$1",[f.covered]);const old=await generate();await db.query("update payroll_periods set status='closed' where id=$1",[old]);await db.exec("update payroll_entries set status='locked';delete from driver_settlement_items");const original=await snapshot();
 await expect(generate('2026-02-01','2026-02-28')).rejects.toThrow('finance_payroll_reimbursement_already_claimed');expect(await snapshot()).toEqual(original);
});
it('requires explicit source review for historical settlement payroll without frozen IDs',async()=>{
 const f=await fixture();await db.query("update driver_expenses set expense_at='2026-02-20T12:00:00Z' where id=$1",[f.covered]);const old=await generate();await db.query("update payroll_periods set status='closed' where id=$1",[old]);await db.exec("update payroll_entries set status='locked';update payroll_entry_items set source_metadata='{}';delete from driver_settlement_items");const original=await snapshot();
 await expect(generate('2026-02-01','2026-02-28')).rejects.toThrow('finance_payroll_historical_source_review');expect(await snapshot()).toEqual(original);
});

it('cancelled but paid prior payroll cannot be bypassed by moving the settlement to another period',async()=>{
 const f=await fixture();await db.query("update driver_settlements set trip_completed_at='2026-02-20T12:00:00Z' where id=$1",[f.settlement]);const old=await generate();await db.query("update payroll_periods set status='cancelled' where id=$1",[old]);
 await db.query("insert into payables select gen_random_uuid(),tenant_id,'payroll_entries',id from payroll_entries where payroll_period_id=$1",[old]);await db.exec('insert into payables_payments select gen_random_uuid(),tenant_id,id,100 from payables');const original=await snapshot();
 await expect(generate('2026-02-01','2026-02-28')).rejects.toThrow('finance_payroll_reimbursement_already_claimed');expect(await snapshot()).toEqual(original);
});
