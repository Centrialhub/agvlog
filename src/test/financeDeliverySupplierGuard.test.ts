// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceLedgerDatabase, financeIds as i } from './helpers/financeLedgerDatabase';

let db: PGlite;
const stop = randomUUID(), doc1 = randomUUID(), doc2 = randomUUID();
const supplier1 = randomUUID(), supplier2 = randomUUID();
beforeAll(async () => {
  db = await createFinanceLedgerDatabase();
  await db.exec(`create table dispatch_stops(id uuid primary key,tenant_id uuid);
    create table fiscal_documents(id uuid primary key,tenant_id uuid,supplier_id uuid);
    create table dispatch_stop_documents(id uuid primary key default gen_random_uuid(),tenant_id uuid,dispatch_stop_id uuid,fiscal_document_id uuid);`);
  await db.query('insert into dispatch_stops values($1,$2)', [stop, i.tenant]);
  await db.query('insert into fiscal_documents values($1,$3,$4),($2,$3,$5)', [doc1, doc2, i.tenant, supplier1, supplier2]);
  await db.exec(readFileSync('supabase/migrations/20260909215046_finance_delivery_supplier_guard.sql', 'utf8'));
}, 30000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });
const add = (doc: string) => db.query('insert into dispatch_stop_documents(tenant_id,dispatch_stop_id,fiscal_document_id) values($1,$2,$3)', [i.tenant, stop, doc]);
const validate = () => db.exec('set constraints all immediate');

describe('delivery supplier invariant for direct database writes', () => {
  it('rejects mixed suppliers at the transaction boundary', async () => {
    await add(doc1); await add(doc2);
    await expect(validate()).rejects.toThrow('finance_delivery_mixed_suppliers');
  });
  it('allows multiple NFs of the same supplier', async () => {
    await db.query('update fiscal_documents set supplier_id=$1 where id=$2', [supplier1, doc2]);
    await add(doc1); await add(doc2);
    await expect(validate()).resolves.toBeDefined();
  });
  it('checks supplier edits after allocation, permitting an atomic correction of all NFs', async () => {
    await db.query('update fiscal_documents set supplier_id=$1', [supplier1]);
    await add(doc1); await add(doc2); await validate();
    await db.exec('set constraints all deferred');
    await db.query('update fiscal_documents set supplier_id=$1', [supplier2]);
    await expect(validate()).resolves.toBeDefined();
  });
  it('rejects a supplier edit that makes a previously consistent delivery mixed', async () => {
    await db.query('update fiscal_documents set supplier_id=$1', [supplier1]);
    await add(doc1); await add(doc2); await validate();
    await db.exec('set constraints all deferred');
    await db.query('update fiscal_documents set supplier_id=$1 where id=$2', [supplier2, doc2]);
    await expect(validate()).rejects.toThrow('finance_delivery_mixed_suppliers');
  });
  it('rejects an allocation to an NF from another company', async () => {
    await db.query('update fiscal_documents set tenant_id=$1 where id=$2', [i.otherTenant, doc1]);
    await add(doc1);
    await expect(validate()).rejects.toThrow('finance_delivery_document_scope_invalid');
  });
  it('allows unknown supplier as an explicit pending delivery', async () => {
    await db.query('update fiscal_documents set supplier_id=null where id=$1', [doc1]);
    await add(doc1);
    await expect(validate()).resolves.toBeDefined();
  });
});
