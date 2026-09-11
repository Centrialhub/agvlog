// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,afterAll,beforeEach,afterEach,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createFinanceLedgerDatabase,financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
import {settlementExpenseContextSchema} from '@/lib/financial/settlementExpenseContextContract';
let db:PGlite;const settlement=randomUUID(),trip=randomUUID(),batch=randomUUID();
beforeAll(async()=>{
 db=await createFinanceLedgerDatabase();await db.exec(`create table driver_settlements(id uuid,tenant_id uuid,dispatch_trip_id uuid,driver_id uuid);
 create table finance_expense_batches(id uuid,tenant_id uuid,context text,trip_id uuid,driver_id uuid);
 create table finance_expense_items(id uuid,tenant_id uuid,batch_id uuid,category text,description text,occurred_on date,amount_cents bigint,payable_id uuid);
 create table finance_expense_allocations(tenant_id uuid,expense_id uuid,amount_cents bigint);
 create table payables(id uuid,tenant_id uuid,status text,supplier_name text,amount numeric(14,2),source_table text,source_id uuid);
 create table payables_payments(tenant_id uuid,payable_id uuid,amount numeric(14,2));
 create view finance_private.active_payable_payments as select * from payables_payments;`);
 await db.exec(readFileSync('supabase/migrations/20260910134943_finance_settlement_expense_context.sql','utf8'));
});
afterAll(()=>db.close());beforeEach(async()=>{await db.exec('begin');await db.query('insert into driver_settlements values($1,$2,$3,$4)',[settlement,i.tenant,trip,i.driver]);await db.query("insert into finance_expense_batches values($1,$2,'trip',$3,$4)",[batch,i.tenant,trip,i.driver]);});afterEach(()=>db.exec('rollback'));
async function expense(amount=50000,allocated=40000,payee='driver'){
 const id=randomUUID(),payable=allocated<amount?randomUUID():null;
 await db.query("insert into finance_expense_items values($1,$2,$3,'food','Alimentação','2026-01-01',$4,$5)",[id,i.tenant,batch,amount,payable]);
 if(allocated)await db.query('insert into finance_expense_allocations values($1,$2,$3)',[i.tenant,id,allocated]);
 if(payable)await db.query("insert into payables values($1,$2,'pending','Favorecido QA',$3,'finance_expense_items',$4)",[payable,i.tenant,(amount-allocated)/100,id]);
 await db.query("insert into finance_commands(tenant_id,request_id,actor_id,action,payload,result) values($1,$2,$3,'record_expense_batch',$4::jsonb,$5::jsonb)",[i.tenant,randomUUID(),i.operator,JSON.stringify({items:[{id,payee_type:payee}]}),JSON.stringify({batch_id:batch})]);return {id,payable};
}
async function read(page=1,actor=i.operator,tenant=i.tenant){return settlementExpenseContextSchema.parse((await financeAs<{r:unknown}>(db,actor,'select get_finance_settlement_expense_context($1,$2,$3) r',[tenant,settlement,page])).rows[0].r);}
it('separates original cost, existing allocation and the remaining title without making another claim',async()=>{
 const e=await expense();await db.query('insert into payables_payments values($1,$2,30)',[i.tenant,e.payable]);
 expect(await read()).toMatchObject({total:1,total_cents:'50000',allocated_cents:'40000',payable_cents:'10000',paid_cents:'3000',outstanding_cents:'7000',needs_review_count:0,rows:[{id:e.id,payee_type:'driver'}]});
 expect((await db.query('select * from payables')).rows).toHaveLength(1);expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
});
it('does not infer driver creditor from the trip driver when the recorded payee was the supplier',async()=>{
 const e=await expense(10000,0,'supplier');expect((await read()).rows[0]).toMatchObject({id:e.id,payee_type:'supplier',needs_review:false});
});
it('shows inconsistencies in title identity, cancellation and amount instead of masking them',async()=>{
 const e=await expense();await db.query("update payables set amount=200,status='cancelled',source_id=$1 where id=$2",[randomUUID(),e.payable]);
 expect(await read()).toMatchObject({needs_review_count:1,outstanding_cents:'0',rows:[{needs_review:true}]});
});
it('includes fully funded costs and aggregates beyond the page',async()=>{
 for(let n=0;n<31;n++)await expense(100,100);expect(await read()).toMatchObject({total:31,total_cents:'3100',allocated_cents:'3100',payable_cents:'0',needs_review_count:0});
 expect((await read()).rows).toHaveLength(30);expect((await read(2)).rows).toHaveLength(1);expect((await read()).rows[0].payee_type).toBe('none');
});
it('denies driver and foreign-tenant access and never infers a manual settlement trip',async()=>{
 await expense();await expect(read(1,i.driverUser)).rejects.toThrow('finance_access_denied');await expect(read(1,i.operator,i.otherTenant)).rejects.toThrow('finance_access_denied');
 await db.query('update driver_settlements set dispatch_trip_id=null where id=$1',[settlement]);expect(await read()).toMatchObject({total:0,total_cents:'0'});
});
