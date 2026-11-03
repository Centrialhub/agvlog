// @vitest-environment node
import { PGlite } from '@electric-sql/pglite';
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { contractorFixture } from './helpers/contractorCteFixture';

const tenant = '10000000-0000-4000-8000-000000000001';
const other = '10000000-0000-4000-8000-000000000002';
const actor = '20000000-0000-4000-8000-000000000001';
const driver = '20000000-0000-4000-8000-000000000002';
const hash = 'a'.repeat(64);
const path = `${tenant}/${actor}/${hash}.pdf`;
let db: PGlite;

beforeAll(async () => {
  db = new PGlite();
  await db.exec(`
    create role anon; create role authenticated; create role service_role; create schema auth; create schema private; create schema storage;
    create table auth.users(id uuid primary key);
    create table public.tenants(id uuid primary key);
    create table public.tenant_memberships(tenant_id uuid,user_id uuid,role text,active boolean);
    create function auth.uid() returns uuid language sql stable as $$select nullif(current_setting('request.actor',true),'')::uuid$$;
    create function private.request_tenant_id() returns uuid language plpgsql stable as $$
      declare h text:=nullif(current_setting('request.tenant',true),''); c text:=nullif(current_setting('request.claim',true),'');
      begin if c is null or (h is not null and c<>h) then raise exception 'tenant_context_claim_mismatch' using errcode='42501'; end if; return c::uuid; end $$;
    create function private.is_request_tenant_member(t uuid) returns boolean language sql stable security definer as $$
      select t=private.request_tenant_id() and exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active)$$;
    create function public.is_tenant_operator_or_admin(t uuid) returns boolean language sql stable security definer as $$
      select exists(select 1 from public.tenant_memberships where tenant_id=t and user_id=auth.uid() and active and role in ('owner','admin','operator'))$$;
    grant usage on schema auth,private,storage to authenticated;
    create table storage.buckets(id text primary key,name text,public boolean,file_size_limit bigint,allowed_mime_types text[]);
    create table storage.objects(id uuid default gen_random_uuid(),bucket_id text,name text,metadata jsonb,unique(bucket_id,name));
    alter table storage.objects enable row level security;
    grant select,insert,update,delete on storage.objects to authenticated;
    grant usage on schema storage to anon; grant select on storage.objects to anon;
    insert into public.tenants values('${tenant}'),('${other}');
    insert into auth.users values('${actor}'),('${driver}');
    insert into public.tenant_memberships values('${tenant}','${actor}','operator',true),('${tenant}','${driver}','driver',true);
  `);
  await db.exec(readFileSync('supabase/migrations/20261103174106_import_contractor_cte_sources.sql', 'utf8'));
}, 30_000);
afterAll(async () => db?.close());
beforeEach(async () => {
  await db.exec(`reset role; truncate public.contractor_cte_sources; truncate storage.objects;
    set request.actor='${actor}'; set request.tenant='${tenant}'; set request.claim='${tenant}';`);
  await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
    ['contractor-cte-originals', path, { size: 31, mimetype: 'application/pdf' }]);
});
async function register(document: unknown = contractorFixture, sourceHash = hash) {
  return (await db.query<{ id: string }>('select public.register_contractor_cte_source_v1($1,$2,$3,$4,$5) as id',
    [tenant, document, sourceHash, 31, 'dacte-qa.pdf'])).rows[0].id;
}

describe('contractor CT-e registration in PostgreSQL (catalog helpers fixture; no Storage HTTP or fiscal issuance)', () => {
  it('registers a preserved original and repeats without another source', async () => {
    await db.exec('set role authenticated');
    const id = await register();
    expect(await register()).toBe(id);
    expect((await db.query('select * from public.contractor_cte_sources')).rows).toHaveLength(1);
  });
  it('does not register metadata when the original is absent or its size is different', async () => {
    await db.exec('delete from storage.objects; set role authenticated');
    await expect(register()).rejects.toMatchObject({ message: 'contractor_cte_original_unconfirmed' });
    await db.exec('reset role');
    await db.query('insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)',
      ['contractor-cte-originals', path, { size: 30, mimetype: 'application/pdf' }]);
    await db.exec('set role authenticated');
    await expect(register()).rejects.toMatchObject({ message: 'contractor_cte_original_unconfirmed' });
  });
  it('rejects conflicting metadata instead of overwriting the registered original', async () => {
    await db.exec('set role authenticated'); await register();
    await expect(register({ ...contractorFixture, issuer_name: 'Outro nome' })).rejects.toMatchObject({ code: '23505' });
    expect((await db.query<{ document: typeof contractorFixture }>('select document from public.contractor_cte_sources')).rows[0].document.issuer_name).toBe(contractorFixture.issuer_name);
  });
  it('blocks a driver and an inactive operator', async () => {
    await db.exec(`set role authenticated; set request.actor='${driver}'`);
    await expect(register()).rejects.toMatchObject({ code: '42501' });
    await db.exec(`reset role; update public.tenant_memberships set active=false where user_id='${actor}'; set request.actor='${actor}'; set role authenticated`);
    await expect(register()).rejects.toMatchObject({ code: '42501' });
    await db.exec(`reset role; update public.tenant_memberships set active=true where user_id='${actor}'`);
  });
  it('blocks a forged selected tenant and hides rows after a legitimate context change', async () => {
    await db.exec('set role authenticated'); await register();
    await db.exec(`set request.tenant='${other}'`);
    await expect(register()).rejects.toMatchObject({ code: '42501' });
    await db.exec(`set request.claim='${other}'`);
    expect((await db.query('select * from public.contractor_cte_sources')).rows).toEqual([]);
    expect((await db.query("select * from storage.objects where bucket_id='contractor-cte-originals'")).rows).toEqual([]);
  });
  it.each([
    { ...contractorFixture, access_key: '1'.repeat(44) },
    { ...contractorFixture, issuer_cnpj: '99999999000199' },
    { ...contractorFixture, number: '124' },
    { ...contractorFixture, authorization_declared: true },
    { ...contractorFixture, environment: 'unknown' },
    { ...contractorFixture, unsupported_field: 'not part of the reviewed contract' },
    { ...contractorFixture, number: 123 },
    { ...contractorFixture, issuer_address: { ...contractorFixture.issuer_address, zip: 39400000 } },
  ])('rejects inconsistent fiscal metadata', async document => {
    await db.exec('set role authenticated'); await expect(register(document)).rejects.toMatchObject({ code: '22023' });
  });
  it('prevents direct metadata writes, replacement or deletion of originals, and anonymous reads', async () => {
    await db.exec('set role authenticated'); await register();
    await expect(db.query('delete from public.contractor_cte_sources')).rejects.toMatchObject({ code: '42501' });
    expect((await db.query("delete from storage.objects where bucket_id='contractor-cte-originals' returning name")).rows).toEqual([]);
    expect((await db.query("update storage.objects set name='changed' returning name")).rows).toEqual([]);
    await db.exec('reset role;set role anon');
    await expect(register()).rejects.toMatchObject({ code: '42501' });
    await expect(db.query('select * from public.contractor_cte_sources')).rejects.toMatchObject({ code: '42501' });
    expect((await db.query('select * from storage.objects')).rows).toEqual([]);
  });
  it('allows only an operator upload inside the current actor and company path', async () => {
    await db.exec('set role authenticated');
    const sql = 'insert into storage.objects(bucket_id,name,metadata) values($1,$2,$3)';
    await expect(db.query(sql, ['contractor-cte-originals', `${other}/${actor}/${hash}.xml`, {}])).rejects.toMatchObject({ code: '42501' });
    await expect(db.query(sql, ['contractor-cte-originals', `${tenant}/${driver}/${hash}.xml`, {}])).rejects.toMatchObject({ code: '42501' });
    await db.query(sql, ['contractor-cte-originals', `${tenant}/${actor}/${hash}.xml`, {}]);
  });
});
