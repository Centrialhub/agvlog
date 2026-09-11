// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceLedgerDatabase, financeAs, financeIds as i } from './helpers/financeLedgerDatabase';
import {expenseHistorySchema} from '@/lib/financial/expenseHistoryContract';
let db: PGlite;
const trip = randomUUID();
beforeAll(async () => {
  db = await createFinanceLedgerDatabase();
  await db.exec(`alter table drivers add column name text default 'Motorista QA';
    create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
    create table cost_centers(id uuid primary key,tenant_id uuid,name text,active boolean);
    create table dispatch_trips(id uuid primary key,tenant_id uuid,driver_id uuid,status text);
    create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,destination text);
    create table fiscal_documents(id uuid primary key,tenant_id uuid,supplier_id uuid,client_id uuid);
    create table dispatch_stop_documents(id uuid primary key,tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);
    create table receivables(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,description text,amount numeric,status text,due_date date,created_by uuid);
    create table payables(id uuid primary key default gen_random_uuid(),tenant_id uuid,supplier_name text,supplier_id uuid,
      category text,description text,amount numeric,due_date date,competence_date date,status text,driver_id uuid,dispatch_trip_id uuid,
      document_number text,receipt_url text,created_by uuid,source_table text,source_id uuid,cost_center text);
  `);
  await db.query("insert into dispatch_trips values($1,$2,$3,'completed')", [trip, i.tenant, i.driver]);
  await db.exec(readFileSync('supabase/migrations/20260909212514_finance_delivery_unloading.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20260909213959_finance_expense_batches.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20260909220020_finance_expense_workspace_queries.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20260909221405_finance_expense_history_queries.sql', 'utf8'));
  await db.exec(readFileSync('supabase/migrations/20260910124716_finance_expense_cost_center_totals.sql', 'utf8'));
  // This narrow batch fixture reads the current history contract. Cancellation
  // commands and guards are exercised separately by createExpenseCancellationDatabase.
  const cancellations=readFileSync('supabase/migrations/20260910175641_finance_unpaid_expense_cancellation.sql','utf8').match(/create table public\.finance_expense_cancellations\([\s\S]*?\n\);/)?.[0];
  if(!cancellations)throw new Error('Cancellation table contract missing');
  await db.exec(cancellations);
  await db.exec(readFileSync('supabase/migrations/20260910175733_finance_expense_cancellation_preview.sql','utf8'));
}, 30000);
beforeEach(async () => { await db.exec('begin'); }); afterEach(async () => { await db.exec('rollback'); }); afterAll(async () => { await db?.close(); });
async function send(amount = 50000) {
  const p = { version: 1, tenant_id: i.tenant, request_id: randomUUID(), bank_account_id: i.account, direction: 'out',
    nature: 'driver_advance', amount_cents: amount, driver_id: i.driver, occurred_on: '2026-01-01',
    description: 'Envio viagem', beneficiary_name: 'Motorista QA', reason: 'Registro do envio antes do retorno' };
  return (await financeAs<{ result: { movement_id: string } }>(db, i.operator, 'select record_finance_movement($1::jsonb) result', [JSON.stringify(p)])).rows[0].result.movement_id;
}
function line(category: string, amount: number, movement?: string, allocated = amount) {
  return { id: randomUUID(), category, description: category, amount_cents: amount, occurred_on: '2026-01-01',
    supplier_name: 'Comércio QA', no_receipt_reason: 'Recibo pendente de conferência', payee_type: 'driver',
    allocations: movement ? [{ movement_id: movement, amount_cents: allocated }] : [] };
}
function batch(items: unknown[]) { return { version: 1, tenant_id: i.tenant, request_id: randomUUID(), context: 'trip', trip_id: trip,
  description: 'Gastos da viagem no retorno', reason: 'Conferência dos recibos da viagem', items }; }
async function record(p: ReturnType<typeof batch>) {
  return (await financeAs<{ result: Record<string, unknown> }>(db, i.operator, 'select record_finance_expense_batch($1::jsonb) result', [JSON.stringify(p)])).rows[0].result;
}
it('counts expenses once by cost center across shared sends, complements and pagination',async()=>{
 const a=randomUUID(),b=randomUUID(),movement=await send();
 await db.query("insert into cost_centers values($1,$3,'Operação',true),($2,$3,'Operação',true)",[a,b,i.tenant]);
 await record(batch([{...line('fuel',30000,movement),cost_center_id:a},{...line('food',40000,movement,20000),cost_center_id:b},line('other',1000)]));
 const read=async(filters:Record<string,unknown>)=>expenseHistorySchema.parse((await financeAs<{result:unknown}>(db,i.operator,'select list_finance_expenses($1,$2::jsonb) result',[i.tenant,JSON.stringify(filters)])).rows[0].result);
 const all=await read({page_size:1});
 expect(all.rows).toHaveLength(1);expect(all).toMatchObject({total:3,total_cents:'71000',allocated_cents:'50000',complement_cents:'21000'});
 expect(all.cost_centers).toHaveLength(3);
 expect(all.cost_centers.find(c=>c.cost_center_id===a)).toMatchObject({amount_cents:'30000',item_count:1});
 expect(all.cost_centers.find(c=>c.cost_center_id===b)).toMatchObject({amount_cents:'40000',item_count:1});
 expect(await read({cost_center:b})).toMatchObject({total:1,total_cents:'40000',allocated_cents:'20000'});
 expect(await read({cost_center:'unassigned'})).toMatchObject({total:1,total_cents:'1000'});
 expect(await read({cost_center:randomUUID()})).toMatchObject({total:0,total_cents:'0',cost_centers:[]});
});
describe('batch expense composition reuses recorded money', () => {
  it('lists costs by category without multiplying the shared send, with full-filter totals and actor history',async()=>{
    const movement=await send();await record(batch([line('fuel',30000,movement),line('food',5000,movement),line('toll',15000,movement)]));
    const result=(await financeAs<{result:unknown}>(db,i.operator,'select list_finance_expenses($1,$2::jsonb) result',
      [i.tenant,JSON.stringify({page:1,page_size:1})])).rows[0].result;
    const parsed=expenseHistorySchema.parse(result);
    expect(parsed).toMatchObject({total:3,total_cents:'50000',allocated_cents:'50000',complement_cents:'0',missing_receipt_count:3});
    expect(parsed.rows).toHaveLength(1);expect(parsed.categories).toHaveLength(3);
    expect(parsed.rows[0].allocations[0]).toMatchObject({movement_id:movement,movement_amount_cents:50000});
    expect(parsed.rows[0].history[0]).toMatchObject({actor_id:i.operator,actor_name:'Financeiro QA',reason:'Conferência dos recibos da viagem'});
    const filtered=(await financeAs<{result:unknown}>(db,i.operator,'select list_finance_expenses($1,$2::jsonb) result',
      [i.tenant,JSON.stringify({category:'food'})])).rows[0].result;
    expect(expenseHistorySchema.parse(filtered)).toMatchObject({total:1,total_cents:'5000',allocated_cents:'5000'});
  });
  it('denies history to drivers and other tenants and rejects reversed date filters',async()=>{
    await record(batch([line('food',5000)]));
    await expect(financeAs(db,i.driverUser,'select list_finance_expenses($1)',[i.tenant])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select list_finance_expenses($1)',[i.otherTenant])).rejects.toThrow('finance_access_denied');
    await expect(financeAs(db,i.operator,'select list_finance_expenses($1,$2::jsonb)',
      [i.tenant,JSON.stringify({from:'2026-02-01',to:'2026-01-01'})])).rejects.toThrow('finance_invalid_expense_filters');
  });
  it('offers only the remaining amount, scopes driver sends to the selected completed trip, and denies drivers', async () => {
    const movement = await send(); await record(batch([line('food', 12000, movement)]));
    const options = async (tripId: string | null, actor=i.operator) => (await financeAs<{result:{rows:Array<{id:string;remaining_cents:number}>}}>(db,actor,
      "select get_finance_expense_options($1,'movements','',$2,1) result",[i.tenant,tripId])).rows[0].result;
    expect((await options(trip)).rows).toMatchObject([{id:movement,remaining_cents:38000}]);
    expect((await options(null)).rows).toEqual([]);
    await expect(options(trip,i.driverUser)).rejects.toThrow('finance_access_denied');
    await db.query("update dispatch_trips set status='in_transit' where id=$1",[trip]);
    await expect(options(trip)).rejects.toThrow('finance_trip_not_completed');
  });

  it('paginates the full option result and interprets a percent sign as a literal search', async () => {
    await db.query(`insert into clients select gen_random_uuid(),$1,'Fornecedor '||n,true from generate_series(1,35) n`,[i.tenant]);
    await db.query("insert into clients values(gen_random_uuid(),$1,'Comércio 100%',true)",[i.tenant]);
    const first=(await financeAs<{result:{total:number;rows:unknown[]}}>(db,i.operator,
      "select get_finance_expense_options($1,'suppliers','',null,1) result",[i.tenant])).rows[0].result;
    expect(first.total).toBe(36);expect(first.rows).toHaveLength(30);
    const filtered=(await financeAs<{result:{total:number;rows:Array<{label:string}>}}>(db,i.operator,
      "select get_finance_expense_options($1,'suppliers','%',null,1) result",[i.tenant])).rows[0].result;
    expect(filtered.total).toBe(1);expect(filtered.rows[0].label).toBe('Comércio 100%');
  });
  it('records separate cost categories against one movement without a new outgoing payment', async () => {
    const movement = await send(); const p = batch([line('fuel', 30000, movement), line('food', 5000, movement), line('toll', 15000, movement)]);
    const first = await record(p); expect(await record(p)).toEqual(first);
    expect((await db.query('select category,amount_cents::int from finance_expense_items order by category')).rows)
      .toEqual([{ category: 'food', amount_cents: 5000 }, { category: 'fuel', amount_cents: 30000 }, { category: 'toll', amount_cents: 15000 }]);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
    expect((await db.query('select * from payables')).rows).toHaveLength(0);
  });
  it('keeps R$20 unallocated after R$480 expenses without inventing a category', async () => {
    const movement = await send(); await record(batch([line('fuel', 48000, movement)]));
    expect((await db.query(`select (m.amount_cents-coalesce(sum(a.amount_cents),0))::int remaining
      from finance_movements m left join finance_expense_allocations a on a.movement_id=m.id group by m.id`)).rows[0]).toEqual({ remaining: 2000 });
  });
  it('creates only the R$30 complement payable to the explicitly selected driver', async () => {
    const movement = await send(); await record(batch([line('fuel', 53000, movement, 50000)]));
    expect((await db.query('select supplier_name,amount::float from payables')).rows).toEqual([{ supplier_name: 'Motorista QA', amount: 30 }]);
  });
  it('rejects overspending the same movement across lines and rolls back the whole batch', async () => {
    const movement = await send();
    await expect(record(batch([line('fuel', 40000, movement), line('food', 20000, movement)]))).rejects.toThrow('finance_movement_overallocated');
    expect((await db.query('select * from finance_expense_items')).rows).toHaveLength(0);
    expect((await db.query('select * from finance_expense_batches')).rows).toHaveLength(0);
  });
  it('records a general office expense without requiring a trip or driver', async () => {
    const p = { ...batch([{ ...line('office', 10000), payee_type: 'supplier' }]), context: 'office', trip_id: undefined };
    await record(p as unknown as ReturnType<typeof batch>);
    expect((await db.query('select supplier_name,amount::float from payables')).rows).toEqual([{ supplier_name: 'Comércio QA', amount: 100 }]);
  });
  it('rejects a trip not yet completed and denies drivers', async () => {
    await db.query("update dispatch_trips set status='in_transit' where id=$1", [trip]);
    const p = batch([line('food', 500)]);
    await expect(record(p)).rejects.toThrow('finance_trip_not_completed');
    await expect(financeAs(db, i.driverUser, 'select record_finance_expense_batch($1::jsonb)', [JSON.stringify(p)])).rejects.toThrow('finance_access_denied');
  });
});
