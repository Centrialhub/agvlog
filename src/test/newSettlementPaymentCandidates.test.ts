// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;const settlement=randomUUID();
type Candidate={id:string;occurred_on:string;remaining_cents:number};
type Options={balance_cents:number;total:number;rows:Candidate[]};
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();
 await db.exec(`create table driver_settlements(id uuid primary key,tenant_id uuid,driver_id uuid,status text,needs_recalculation boolean,driver_payable_amount numeric,total_paid_amount numeric);
 create table driver_settlement_payments(id uuid primary key,tenant_id uuid,settlement_id uuid,amount numeric,paid_at timestamptz);
 create table finance_expense_allocations(tenant_id uuid,movement_id uuid,amount_cents bigint);
 create table finance_payable_movement_links(id uuid,tenant_id uuid,movement_id uuid,amount_cents bigint);
 create table finance_payable_link_reversals(tenant_id uuid,link_id uuid);`);
 await db.exec(readFileSync('supabase/migrations/20260910130540_finance_settlement_movement_links.sql','utf8'));
 await db.exec(readFileSync('supabase/migrations/20260910133355_finance_new_settlement_payment_candidates.sql','utf8'));
});
afterAll(()=>db.close());beforeEach(async()=>{await db.exec('begin');await db.query("insert into driver_settlements values($1,$2,$3,'approved',false,500,0)",[settlement,i.tenant,i.driver]);});afterEach(()=>db.exec('rollback'));
async function movement(date='2026-01-01',driver:string|null=i.driver){
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',amount_cents:50000,occurred_on:date,description:'Saída registrada',beneficiary_name:'Motorista QA',driver_id:driver,reason:'Conferido pelo financeiro'};
 return (await financeAs<{r:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1::jsonb) r',[JSON.stringify(payload)])).rows[0].r.movement_id;
}
async function options(amount=10000,page=1,actor=i.operator,tenant=i.tenant){return (await financeAs<{r:Options}>(db,actor,'select get_finance_settlement_payment_candidates($1,$2,$3,$4) r',[tenant,settlement,amount,page])).rows[0].r;}
it('uses actual payment history rather than the cached settlement total and excludes overpayment candidates',async()=>{
 await movement();await db.query("insert into driver_settlement_payments values($1,$2,$3,400,now())",[randomUUID(),i.tenant,settlement]);
 expect(await options()).toMatchObject({balance_cents:10000,total:1});expect(await options(10001)).toMatchObject({balance_cents:10000,total:0});
});
it('offers historical dates for the same driver and excludes money allocated to other purposes',async()=>{
 const earlier=await movement('2025-12-01'),later=await movement('2026-02-01'),used=await movement();await movement('2026-01-01',null);
 await db.query('insert into finance_expense_allocations values($1,$2,45000)',[i.tenant,used]);
 expect((await options()).rows.map(x=>x.id)).toEqual([later,earlier]);
});
it('paginates after server filtering with an exact total',async()=>{
 for(let n=0;n<21;n++)await movement();expect(await options()).toMatchObject({total:21});expect((await options()).rows).toHaveLength(20);expect((await options(10000,2)).rows).toHaveLength(1);
});
it('rejects protected identities and settlements awaiting review',async()=>{
 await expect(options(10000,1,i.driverUser)).rejects.toThrow('finance_access_denied');await expect(options(10000,1,i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');
 await db.query('update driver_settlements set needs_recalculation=true where id=$1',[settlement]);await expect(options()).rejects.toThrow('finance_settlement_requires_review');
});
it('does not disguise invalid payment data as an available balance',async()=>{
 await db.query('insert into driver_settlement_payments values($1,$2,$3,-10,now())',[randomUUID(),i.tenant,settlement]);await expect(options()).rejects.toThrow('finance_settlement_invalid_balance');
 await expect(options(0)).rejects.toThrow('finance_invalid_payment_query');await expect(options(10000,0)).rejects.toThrow('finance_invalid_payment_query');
});
it.each(['NaN','Infinity','1000000000000'])('rejects unsupported balance %s before presenting money',async(value)=>{
 await db.query('update driver_settlements set driver_payable_amount=$1::numeric where id=$2',[value,settlement]);
 await expect(options()).rejects.toThrow('finance_settlement_invalid_balance');
});
