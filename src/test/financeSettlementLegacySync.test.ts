// @vitest-environment node
import {readFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import {beforeAll,beforeEach,afterEach,afterAll,it,expect} from 'vitest';
import type {PGlite} from '@electric-sql/pglite';
import {createSettlementPaymentDatabase} from './helpers/financeSettlementPaymentDatabase';
import {financeAs,financeIds as i} from './helpers/financeLedgerDatabase';
let db:PGlite;
beforeAll(async()=>{
 db=await createSettlementPaymentDatabase();const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');
 // Replace the unrelated narrow bank placeholder with its actual baseline shape.
 await db.exec('drop table bank_transactions');
 for(const table of ['bank_transactions','receivables','driver_expenses','financial_obligations']){
  const create=baseline.match(new RegExp(`CREATE TABLE public\\.${table} \\([\\s\\S]*?\\n\\);`))?.[0];if(!create)throw new Error(table);await db.exec(create);
  const defaults=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ALTER COLUMN[\\s\\S]*?;`))?.[0];if(defaults)await db.exec(defaults);
  const constraints=baseline.match(new RegExp(`ALTER TABLE ONLY public\\.${table}\\s+ADD CONSTRAINT[\\s\\S]*?;`))?.[0];if(constraints)await db.exec(constraints);
 }
 const index=baseline.match(/CREATE UNIQUE INDEX uq_financial_obligations_source[\s\S]*?;/)?.[0];if(!index)throw new Error('source unique index');await db.exec(index);
 for(const name of ['sync_financial_obligations','_tg_sync_obligations_from_settlement','_tg_sync_obligations_from_settlement_payment','_tg_sync_obligations_from_payable','_tg_sync_obligations_from_expense']){
  const body=baseline.match(new RegExp(`CREATE OR REPLACE FUNCTION public\\.${name}\\([\\s\\S]*?\\$function\\$;`))?.[0];if(!body)throw new Error(name);await db.exec(body);
 }
 await db.exec('alter table driver_expenses add column review_command_id uuid');
 const expenseReview=readFileSync('supabase/migrations/20260830203548_audit_driver_expense_reviews.sql','utf8');
 const reviewedTrigger=expenseReview.match(/create or replace function public\._tg_sync_obligations_from_expense\(\)[\s\S]*?\$fn\$;/)?.[0];
 if(!reviewedTrigger)throw new Error('reviewed expense trigger missing');await db.exec(reviewedTrigger);
 // Actual financial boundary wraps the installed legacy sync body; the later
 // retirement migration explicitly retains this routine for these triggers.
 const boundary=readFileSync('supabase/migrations/20260909235237_finance_legacy_rpc_boundary.sql','utf8');
 // Only install this routine's actual guard template: the shared helper has
 // already installed later payroll wrappers, so replaying their older wrapper
 // out of migration order would be an invalid fixture, not the production chain.
 const scopedBoundary=boundary.replace(/for spec in select \* from \(values[\s\S]*?\) s\(name,kind\) loop/,
  "for spec in select * from (values ('sync_financial_obligations','tenant')) s(name,kind) loop");
 if(scopedBoundary===boundary)throw new Error('legacy boundary scope anchor changed');await db.exec(scopedBoundary);
 for(const name of ['trg_sync_obligations_from_settlement','trg_sync_obligations_from_settlement_payment','trg_sync_obligations_from_payable','trg_sync_obligations_from_expense']){
  const trigger=baseline.match(new RegExp(`CREATE TRIGGER ${name} [\\s\\S]*?;`))?.[0];if(!trigger)throw new Error(name);await db.exec(trigger);
 }
},30000);
beforeEach(async()=>{await db.exec(`begin;set request.jwt.claim.sub='${i.operator}'`);});afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db.close();});
async function fixture(){
 const settlement=randomUUID();await db.query("insert into driver_settlements(id,tenant_id,driver_id,status,driver_payable_amount,approved_at,trip_started_at,trip_completed_at,created_at) values($1,$2,$3,'approved',500,'2026-01-09T15:00:00Z','2026-01-01T15:00:00Z','2026-01-20T15:00:00Z','2026-01-01T15:00:00Z')",[settlement,i.tenant,i.driver]);
 const payload={version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',driver_id:i.driver,amount_cents:50000,occurred_on:'2026-01-10',description:'Envio motorista',beneficiary_name:'Motorista QA',reason:'Envio efetuado e conferido'};
 const movement=(await financeAs<{result:{movement_id:string}}>(db,i.operator,'select record_finance_movement($1::jsonb) result',[JSON.stringify(payload)])).rows[0].result.movement_id;
 return {settlement,movement,command:{version:1,tenant_id:i.tenant,request_id:randomUUID(),settlement_id:settlement,movement_id:movement,amount_cents:30000,method:'pix',reason:'Pagamento efetuado e conferido pelo financeiro'}};
}
async function record(p:Record<string,unknown>){const result=(await financeAs<{result:Record<string,unknown>}>(db,i.operator,'select record_finance_settlement_payment($1::jsonb) result',[JSON.stringify(p)])).rows[0].result;await db.exec('set constraints all immediate;set constraints all deferred');return result;}
async function obligations(){return (await db.query('select * from financial_obligations order by id')).rows;}
async function money(){return (await db.query("select jsonb_build_object('movement',(select jsonb_agg(to_jsonb(x) order by id) from finance_movements x),'bank',(select jsonb_agg(to_jsonb(x) order by id) from bank_transactions x),'payment',(select jsonb_agg(to_jsonb(x) order by id) from driver_settlement_payments x)) snapshot")).rows[0];}
it('real legacy triggers permit payment and replay without creating money or duplicate obligations',async()=>{
 const f=await fixture();expect(await obligations()).toHaveLength(1);const result=await record(f.command),snapshot=await money(),obs=await obligations();
 expect(await record(f.command)).toEqual(result);expect(await money()).toEqual(snapshot);expect(await obligations()).toEqual(obs);
 expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);expect((await db.query('select * from driver_settlement_payments')).rows).toHaveLength(1);expect(await obligations()).toHaveLength(1);
});
it('characterizes a material legacy defect: partial payment leaves obligation behind the canonical balance',async()=>{
 const f=await fixture();await record(f.command);const s=(await db.query<{total_paid_amount:string;payment_balance:string}>('select * from driver_settlements')).rows[0];
 expect([s.total_paid_amount,s.payment_balance].map(Number)).toEqual([300,200]);
 const o=(await db.query<{amount_matched:string;open_balance:string;status:string;matching_status:string}>('select * from financial_obligations')).rows[0];
 // This is a characterization of the remaining legacy inconsistency, not approval
 // of its behavior. The sync trigger ran before settlement totals changed.
 expect([Number(o.amount_matched),Number(o.open_balance),o.status,o.matching_status]).toEqual([0,500,'pending','unmatched']);
});
it('full payment marks only the legacy obligation matched, without creating bank evidence',async()=>{
 const f=await fixture();await record({...f.command,amount_cents:50000});const o=(await db.query<{amount_matched:string;status:string;matching_status:string}>('select * from financial_obligations')).rows[0];
 expect([Number(o.amount_matched),o.status,o.matching_status]).toEqual([500,'paid','matched']);expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);
});
it('reversing only the financial association preserves actual payment, cash and legacy obligation',async()=>{
 const f=await fixture(),result=await record(f.command),snapshot=await money(),obs=await obligations();
 const reversal={version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:result.link_id,reason:'Corrigir associação anterior sem desfazer pagamento'};
 await financeAs(db,i.operator,'select reverse_finance_settlement_link($1::jsonb)',[JSON.stringify(reversal)]);await db.exec('set constraints all immediate;set constraints all deferred');
 expect(await money()).toEqual(snapshot);expect(await obligations()).toEqual(obs);expect((await db.query('select * from finance_settlement_link_reversals')).rows).toHaveLength(1);
 expect(await record(f.command)).toEqual(result);expect(await money()).toEqual(snapshot);
});
it('sync touches other legacy obligation projections in the date window without changing source titles',async()=>{
 const f=await fixture(),payable=randomUUID(),receivable=randomUUID(),expense=randomUUID();
 await db.query("insert into payables(id,tenant_id,description,supplier_name,amount,due_date,competence_date) values($1,$2,'Conta sede','Fornecedor QA',75,'2026-01-11','2026-01-11')",[payable,i.tenant]);
 await db.query("insert into receivables(id,tenant_id,description,amount,due_date) values($1,$2,'Frete QA',900,'2026-01-12')",[receivable,i.tenant]);
 await db.query("insert into driver_expenses(id,tenant_id,driver_id,category,amount,expense_at,approval_status,reimbursable,payment_source) values($1,$2,$3,'food',30,'2026-01-10T15:00:00Z','approved',false,'company_account')",[expense,i.tenant,i.driver]);
 const sourceBefore=(await db.query("select jsonb_build_object('p',(select to_jsonb(x) from payables x where id=$1),'r',(select to_jsonb(x) from receivables x where id=$2),'e',(select to_jsonb(x) from driver_expenses x where id=$3)) data",[payable,receivable,expense])).rows[0];
 await record(f.command);expect(await obligations()).toHaveLength(4);
 expect((await db.query("select jsonb_build_object('p',(select to_jsonb(x) from payables x where id=$1),'r',(select to_jsonb(x) from receivables x where id=$2),'e',(select to_jsonb(x) from driver_expenses x where id=$3)) data",[payable,receivable,expense])).rows[0]).toEqual(sourceBefore);
 expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);expect((await db.query('select * from finance_expense_items')).rows).toHaveLength(0);
});


const retirement='20260910135125_finance_retire_bulk_obligation_projection.sql';
it('retires bulk sync preserving OIDs, trigger bindings, history and reviewed expense writer',async()=>{
 const f=await fixture(),old=await obligations();
 const routines=(await db.query("select proname,oid from pg_proc where pronamespace='public'::regnamespace and proname in('sync_financial_obligations','_tg_sync_obligations_from_settlement','_tg_sync_obligations_from_settlement_payment','_tg_sync_obligations_from_payable','_tg_sync_obligations_from_expense') order by proname")).rows;
 const bindings=(await db.query("select tgname,tgfoid from pg_trigger where tgname like 'trg_sync_obligations%' order by tgname")).rows;
 await db.exec(readFileSync('supabase/migrations/'+retirement,'utf8'));
 expect(await obligations()).toEqual(old);expect((await db.query("select proname,oid from pg_proc where pronamespace='public'::regnamespace and proname in('sync_financial_obligations','_tg_sync_obligations_from_settlement','_tg_sync_obligations_from_settlement_payment','_tg_sync_obligations_from_payable','_tg_sync_obligations_from_expense') order by proname")).rows).toEqual(routines);
 expect((await db.query("select tgname,tgfoid from pg_trigger where tgname like 'trg_sync_obligations%' order by tgname")).rows).toEqual(bindings);
 const result=await record(f.command),snapshot=await money();expect(await record(f.command)).toEqual(result);expect(await money()).toEqual(snapshot);expect(await obligations()).toEqual(old);
 await financeAs(db,i.operator,'select reverse_finance_settlement_link($1::jsonb)',[JSON.stringify({version:1,tenant_id:i.tenant,request_id:randomUUID(),link_id:result.link_id,reason:'Corrigir vínculo mantendo pagamento e história'})]);expect(await money()).toEqual(snapshot);expect(await obligations()).toEqual(old);
 const expense=randomUUID();await db.query("insert into driver_expenses(id,tenant_id,driver_id,category,amount,expense_at,approval_status,reimbursable,payment_source,review_command_id) values($1,$2,$3,'food',30,'2026-01-10T15:00:00Z','approved',false,'company_account',$4)",[expense,i.tenant,i.driver,randomUUID()]);
 expect(await obligations()).toHaveLength(2);expect((await db.query("select source_id,amount_matched::text,matching_status from financial_obligations where source_table='driver_expenses'")).rows[0]).toMatchObject({source_id:expense,amount_matched:'0.00',matching_status:'unmatched'});
 await db.exec('savepoint expense_update');await expect(db.query('update driver_expenses set amount=50 where id=$1',[expense])).rejects.toThrow('expense_existing_obligation_requires_reconciliation');await db.exec('rollback to savepoint expense_update');
 expect((await db.query("select has_function_privilege('authenticated','public.sync_financial_obligations(uuid,date,date)','EXECUTE') allowed")).rows[0]).toEqual({allowed:false});
 await db.exec('savepoint retired_call');await expect(db.query('select sync_financial_obligations($1)',[i.tenant])).rejects.toThrow('finance_bulk_obligation_projection_retired');await db.exec('rollback to savepoint retired_call');
});
it('post-retirement settlement payment creates no new legacy projection or bank evidence',async()=>{
 await db.exec(readFileSync('supabase/migrations/'+retirement,'utf8'));const f=await fixture();expect(await obligations()).toHaveLength(0);await record({...f.command,amount_cents:50000});expect(await obligations()).toHaveLength(0);expect((await db.query('select * from bank_transactions')).rows).toHaveLength(0);expect((await db.query('select status from driver_settlements')).rows[0]).toEqual({status:'paid'});
});
it('refuses retirement when an unreviewed bulk dependency exists',async()=>{
 await db.exec("create function public.qa_unknown_bulk_dependency() returns jsonb language sql as $$select sync_financial_obligations('10000000-0000-4000-8000-000000000001')$$");await db.exec('savepoint retire_attempt');await expect(db.exec(readFileSync('supabase/migrations/'+retirement,'utf8'))).rejects.toThrow('finance_bulk_projection_dependency_review');await db.exec('rollback to savepoint retire_attempt');
});

it('requires the reviewed expense replacement before retiring the shared bulk dependency',async()=>{
 const baseline=readFileSync('supabase/migrations/20260824224152_baseline.sql','utf8');const old=baseline.match(/CREATE OR REPLACE FUNCTION public\._tg_sync_obligations_from_expense\(\)[\s\S]*?\$function\$;/)?.[0];if(!old)throw new Error('baseline expense callback missing');await db.exec(old);
 await db.exec('savepoint prerequisite');await expect(db.exec(readFileSync('supabase/migrations/'+retirement,'utf8'))).rejects.toThrow('finance_reviewed_expense_projection_required');await db.exec('rollback to savepoint prerequisite');
});
