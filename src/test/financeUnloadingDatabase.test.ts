// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceLedgerDatabase, financeAs, financeIds as i } from './helpers/financeLedgerDatabase';

let db: PGlite;
const supplier = randomUUID(), secondSupplier = randomUUID(), client = randomUUID();
const stop = randomUUID(), trip = randomUUID(), doc1 = randomUUID(), doc2 = randomUUID();
const allocation1 = randomUUID(), allocation2 = randomUUID();
beforeAll(async () => {
  db = await createFinanceLedgerDatabase();
  await db.exec(`create table clients(id uuid primary key,tenant_id uuid,company_name text,active boolean);
    create table dispatch_stops(id uuid primary key,tenant_id uuid,dispatch_trip_id uuid,client_id uuid,destination text);
    create table fiscal_documents(id uuid primary key,tenant_id uuid,supplier_id uuid,client_id uuid);
    create table dispatch_stop_documents(id uuid primary key,tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid,delivery_attempt_id uuid);
    create table delivery_attempts(id uuid primary key,tenant_id uuid,source_allocation_id uuid);
    create table receivables(id uuid primary key default gen_random_uuid(),tenant_id uuid,client_id uuid,
      description text,amount numeric,status text,due_date date,created_by uuid);`);
  await db.query("insert into clients values($1,$3,'Fornecedor A',true),($2,$3,'Fornecedor B',true)", [supplier, secondSupplier, i.tenant]);
  await db.query("insert into dispatch_stops values($1,$2,$3,$4,'Destino único')", [stop, i.tenant, trip, client]);
  await db.query('insert into fiscal_documents values($1,$3,$4,$5),($2,$3,$4,$5)', [doc1, doc2, i.tenant, supplier, client]);
  await db.query('insert into dispatch_stop_documents values($1,$3,$4,$5,null),($2,$3,$4,$6,null)', [allocation1, allocation2, i.tenant, stop, doc1, doc2]);
  await db.exec(readFileSync('supabase/migrations/20260909212514_finance_delivery_unloading.sql', 'utf8'));
}, 30000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });
type Context = { revision: string; issue: string | null; supplier_id: string; delivery_stop_id: string; document_count: number };
const context = async (s = stop) => (await financeAs<{ result: Context }>(db, i.operator,
  'select get_finance_delivery_context($1,$2) result', [i.tenant, s])).rows[0].result;
const payload = async (s = stop) => ({ version: 1, tenant_id: i.tenant, request_id: randomUUID(), stop_id: s,
  expected_revision: (await context(s)).revision, amount_cents: 15000, occurred_on: '2026-01-01',
  receipt_path: `${i.tenant}/receipts/unloading.pdf`, reason: 'Conferência da descarga no retorno' });
const record = async (p: Awaited<ReturnType<typeof payload>>) => (await financeAs<{ result: Record<string, unknown> }>(db, i.operator,
  'select record_finance_unloading($1::jsonb) result', [JSON.stringify(p)])).rows[0].result;

describe('one unloading per delivery, supplier determined across all invoices', () => {
  it('supports the verified live graph without the optional delivery-attempt schema', async () => {
    await db.exec('drop table delivery_attempts; alter table dispatch_stop_documents drop column delivery_attempt_id');
    expect(await context()).toMatchObject({ issue: null, supplier_id: supplier, delivery_stop_id: stop });
    expect(await record(await payload())).toMatchObject({ confirmed: true, supplier_id: supplier });
  });
  it('prepares supplier without creating a receivable, then records one charge for two invoices', async () => {
    expect(await context()).toMatchObject({ supplier_id: supplier, delivery_stop_id: stop, document_count: 2, issue: null });
    expect((await db.query('select * from receivables')).rows).toHaveLength(0);
    const p = await payload(); const result = await record(p); expect(await record(p)).toEqual(result);
    expect((await db.query('select client_id,amount::float from receivables')).rows).toEqual([{ client_id: supplier, amount: 150 }]);
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(0);
    await expect(record({ ...p, request_id: randomUUID() })).rejects.toThrow('finance_delivery_already_charged');
  });
  it('rejects mixed suppliers instead of selecting the first or splitting the charge', async () => {
    await db.query('update fiscal_documents set supplier_id=$1 where id=$2', [secondSupplier, doc2]);
    expect((await context()).issue).toBe('mixed_suppliers');
    await expect(record(await payload())).rejects.toThrow('mixed_suppliers');
  });
  it('rejects a missing supplier even if the other invoice has a valid supplier', async () => {
    await db.query('update fiscal_documents set supplier_id=null where id=$1', [doc2]);
    expect((await context()).issue).toBe('supplier_missing');
    await expect(record(await payload())).rejects.toThrow('supplier_missing');
  });
  it('requires a new preview after composition changes', async () => {
    const p = await payload();
    await db.query('update fiscal_documents set supplier_id=$1', [secondSupplier]);
    await expect(record(p)).rejects.toThrow('finance_delivery_changed');
    expect((await db.query('select * from receivables')).rows).toHaveLength(0);
  });
  it('does not charge a redelivery again when the allocation traces back to the same delivery', async () => {
    await record(await payload()); const newStop = randomUUID(), attempt = randomUUID();
    await db.query("insert into dispatch_stops values($1,$2,$3,$4,'Reentrega')", [newStop, i.tenant, trip, client]);
    await db.query('insert into delivery_attempts values($1,$2,$3)', [attempt, i.tenant, allocation1]);
    await db.query('insert into dispatch_stop_documents values($1,$2,$3,$4,$5)', [randomUUID(), i.tenant, newStop, doc1, attempt]);
    expect((await context(newStop)).delivery_stop_id).toBe(stop);
    await expect(record(await payload(newStop))).rejects.toThrow('finance_delivery_already_charged');
  });
  it('rolls back receivable creation if charge insertion fails', async () => {
    await db.exec(`create function fail_unloading() returns trigger language plpgsql as $$begin raise exception 'late unloading failure';end;$$;
      create trigger fail_unloading before insert on finance_unloading_charges for each row execute function fail_unloading();`);
    await expect(record(await payload())).rejects.toThrow('late unloading failure');
    expect((await db.query('select * from receivables')).rows).toHaveLength(0);
  });
  it('denies driver access to prepared financial data and existing charges', async () => {
    await record(await payload());
    await expect(financeAs(db, i.driverUser, 'select get_finance_delivery_context($1,$2)', [i.tenant, stop])).rejects.toThrow('finance_access_denied');
    expect((await financeAs(db, i.driverUser, 'select * from finance_unloading_charges')).rows).toHaveLength(0);
  });
});
