// @vitest-environment node
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll,afterEach,beforeAll,beforeEach,describe,expect,it } from 'vitest';
import { createFinanceLedgerDatabase,financeAs,financeIds as i } from './helpers/financeLedgerDatabase';
let db:PGlite;
const path=`${i.tenant}/finance-batches/proof.pdf`;
beforeAll(async()=>{
  db=await createFinanceLedgerDatabase();
  await db.exec(`create schema storage;create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text,name text,metadata jsonb,created_at timestamptz default now());
    alter table storage.objects enable row level security;
    grant usage on schema storage to authenticated,anon,service_role;grant all on storage.objects to authenticated,anon,service_role;
    create policy legacy_broad_policy on storage.objects for all to authenticated,anon using(true) with check(true);
    create table finance_expense_items(id uuid primary key,tenant_id uuid,receipt_path text);
    create table finance_unloading_charges(id uuid primary key,tenant_id uuid,receipt_path text);`);
  await db.exec(readFileSync('supabase/migrations/20260909220941_finance_receipt_evidence.sql','utf8'));
  await db.exec(readFileSync('supabase/migrations/20260909235705_finance_legacy_receipt_boundary.sql','utf8'));
},30000);
beforeEach(async()=>{await db.exec('begin');await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{\"mimetype\":\"application/pdf\",\"size\":500}')",[path]);});
afterEach(async()=>{await db.exec('rollback');});afterAll(async()=>{await db?.close();});
const record=(receipt=path)=>financeAs(db,i.operator,'select record_finance_movement($1::jsonb)',[JSON.stringify({
  version:1,tenant_id:i.tenant,request_id:randomUUID(),bank_account_id:i.account,direction:'out',nature:'payment',
  amount_cents:50000,occurred_on:'2026-01-01',description:'Compra conferida',beneficiary_name:'Comércio',reason:'Recibo conferido',receipt_path:receipt,
})]);
describe('financial receipt existence and retention',()=>{
  it('protects legacy financial folders while retaining operational proof policies',async()=>{
    for(const root of ['expense-receipts','payable-payments','receivable-payments','payables','deliveries'])await db.query("insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')",[`${i.tenant}/${root}/proof.pdf`]);
    const visible=await financeAs<{name:string}>(db,i.driverUser,'select name from storage.objects');
    expect(visible.rows.map(row=>row.name)).toEqual([`${i.tenant}/deliveries/proof.pdf`]);
    expect((await financeAs(db,i.operator,'select * from storage.objects')).rows).toHaveLength(6);
    await expect(financeAs(db,i.operator,"insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')",[`${i.tenant}/payables/direct.pdf`])).rejects.toThrow('row-level security');
  });
  it('snapshots the stored object and metadata only when evidence exists',async()=>{
    await record();
    const row=(await db.query<{receipt_evidence:{path:string;metadata:{size:number}}}>('select receipt_evidence from finance_movements')).rows[0];
    expect(row.receipt_evidence.path).toBe(path);expect(row.receipt_evidence.metadata.size).toBe(500);
    await expect(record(`${i.tenant}/finance-batches/missing.pdf`)).rejects.toThrow('finance_receipt_not_found');
    expect((await db.query('select * from finance_movements')).rows).toHaveLength(1);
  });
  it('blocks driver reads despite broad legacy storage policies, including mixed memberships',async()=>{
    expect((await financeAs(db,i.operator,'select * from storage.objects')).rows).toHaveLength(1);
    expect((await financeAs(db,i.driverUser,'select * from storage.objects')).rows).toHaveLength(0);
    await db.query("insert into tenant_memberships values($1,$2,'admin',true)",[i.tenant,i.driverUser]);
    expect((await financeAs(db,i.driverUser,'select * from storage.objects')).rows).toHaveLength(0);
  });
  it('blocks direct browser uploads and updates and prevents even privileged deletion',async()=>{
    await expect(financeAs(db,i.operator,"insert into storage.objects(bucket_id,name,metadata) values('receipts',$1,'{}')",[`${i.tenant}/finance-batches/forged.pdf`])).rejects.toThrow();
    expect((await financeAs(db,i.operator,"update storage.objects set metadata='{}' returning id")).rows).toHaveLength(0);
    await db.exec('savepoint deletion');
    await expect(db.query('delete from storage.objects where name=$1',[path])).rejects.toThrow('finance_receipt_retention_required');
    await db.exec('rollback to savepoint deletion');
  });
  it('leaves operational receipt folders outside the financial restriction',async()=>{
    await db.query("insert into storage.objects(bucket_id,name) values('receipts',$1)",[`${i.tenant}/delivery-proofs/photo.jpg`]);
    expect((await financeAs(db,i.driverUser,'select * from storage.objects')).rows).toHaveLength(1);
  });
});
