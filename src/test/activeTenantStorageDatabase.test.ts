// @vitest-environment node
import {PGlite} from '@electric-sql/pglite';
import {readFileSync} from 'node:fs';
import {afterAll,beforeAll,describe,expect,it} from 'vitest';

const a='10000000-0000-4000-8000-000000000001',b='10000000-0000-4000-8000-000000000002';
let db:PGlite;

beforeAll(async()=>{
  db=new PGlite();
  await db.exec(`
    create role anon;create role authenticated;create schema private;create schema storage;
    create function private.request_tenant_id() returns uuid language sql stable
      as $$select coalesce(nullif(current_setting('request.headers',true),'')::jsonb->>'x-agvlog-tenant-id',nullif(current_setting('request.jwt.claims',true),'')::jsonb->>'active_tenant_id')::uuid$$;
    grant usage on schema private to authenticated;grant execute on function private.request_tenant_id() to authenticated;
    create table storage.objects(id uuid primary key default gen_random_uuid(),bucket_id text not null,name text not null);
    alter table storage.objects enable row level security;
    create policy existing_storage_access on storage.objects for all to authenticated using(true) with check(true);
    create policy existing_anon_access on storage.objects for all to anon using(true) with check(true);
    grant usage on schema storage to anon,authenticated;grant select,insert,update,delete on storage.objects to anon,authenticated;
    insert into storage.objects(bucket_id,name) values('receipts','${a}/fiscal/a.pdf'),('receipts','${b}/fiscal/b.pdf'),('avatars','public/avatar.png');
  `);
  await db.exec(readFileSync('supabase/migrations/20260910134010_enforce_tenant_storage_context.sql','utf8'));
},30_000);
afterAll(async()=>db?.close());

describe('active tenant Storage boundary in PostgreSQL',()=>{
  it('shows only the selected company files while leaving non-tenant buckets untouched',async()=>{
    await db.exec(`set role authenticated;set request.headers='{"x-agvlog-tenant-id":"${a}"}'`);
    try{
      expect((await db.query<{name:string}>('select name from storage.objects order by name')).rows).toEqual([{name:`${a}/fiscal/a.pdf`},{name:'public/avatar.png'}]);
    }finally{await db.exec('reset role;reset request.headers');}
  });
  it('rejects a forged path from another active tenant',async()=>{
    await db.exec(`set role authenticated;set request.headers='{"x-agvlog-tenant-id":"${a}"}'`);
    try{await expect(db.query(`insert into storage.objects(bucket_id,name) values('finance-statements','${b}/statement.ofx')`)).rejects.toMatchObject({code:'42501'});}
    finally{await db.exec('reset role;reset request.headers');}
  });
  it('uses the signed claim when Storage cannot forward a custom header',async()=>{
    await db.exec(`set role authenticated;set request.jwt.claims='{"active_tenant_id":"${b}"}'`);
    try{expect((await db.query<{name:string}>("select name from storage.objects where bucket_id='receipts'")).rows).toEqual([{name:`${b}/fiscal/b.pdf`}]);}
    finally{await db.exec('reset role;reset request.jwt.claims');}
  });
  it('never exposes tenant buckets to anon',async()=>{
    await db.exec('set role anon');
    try{expect((await db.query("select name from storage.objects where bucket_id='receipts'")).rows).toEqual([]);}finally{await db.exec('reset role');}
  });
});
