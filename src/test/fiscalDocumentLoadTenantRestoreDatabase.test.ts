// @vitest-environment node
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

const migration = readFileSync('supabase/migrations/20260926185847_enforce_fiscal_document_load_tenant.sql', 'utf8');
const firstTenant = '10000000-0000-4000-8000-000000000001';
const secondTenant = '10000000-0000-4000-8000-000000000002';
const firstLoad = '20000000-0000-4000-8000-000000000001';
const secondLoad = '20000000-0000-4000-8000-000000000002';
const document = '30000000-0000-4000-8000-000000000001';
let db: PGlite;

async function schema(target: PGlite) {
  await target.exec(`
    create table public.loads(id uuid primary key,tenant_id uuid not null);
    create table public.fiscal_documents(id uuid primary key,tenant_id uuid not null,
      load_id uuid references public.loads(id));
    insert into public.loads values
      ('${firstLoad}','${firstTenant}'),('${secondLoad}','${secondTenant}');
  `);
}

beforeAll(async () => {
  db = new PGlite();
  await schema(db);
  await db.query('insert into public.fiscal_documents values($1,$2,$3)',
    [document, firstTenant, firstLoad]);
  await db.exec(migration);
}, 20_000);
afterAll(async () => { await db?.close(); });

describe('fiscal document load tenant integrity', () => {
  it('adds and validates the composite foreign key and preserves it on retry', async () => {
    const getState = async () => (await db.query<{ definition: string; validated: boolean }>(`
      select pg_get_constraintdef(oid) definition,convalidated validated
      from pg_constraint where conrelid='public.fiscal_documents'::regclass
        and conname='fiscal_documents_load_tenant_fkey'`)).rows[0];
    expect(await getState()).toMatchObject({
      definition: expect.stringContaining('FOREIGN KEY (load_id, tenant_id)'),
      validated: true,
    });
    await db.exec(migration);
    expect((await getState()).validated).toBe(true);
    expect((await db.query<{ tenant_id: string; load_id: string }>(
      'select tenant_id,load_id from public.fiscal_documents where id=$1', [document])).rows[0])
      .toEqual({ tenant_id: firstTenant, load_id: firstLoad });
  });

  it('rejects cross-tenant load changes while allowing a matching or empty link', async () => {
    await expect(db.query('update public.fiscal_documents set load_id=$1 where id=$2',
      [secondLoad, document])).rejects.toThrow();
    await db.query('update public.fiscal_documents set load_id=null where id=$1', [document]);
    await db.query('update public.fiscal_documents set tenant_id=$1,load_id=$2 where id=$3',
      [secondTenant, secondLoad, document]);
    expect((await db.query<{ tenant_id: string; load_id: string }>(
      'select tenant_id,load_id from public.fiscal_documents where id=$1', [document])).rows[0])
      .toEqual({ tenant_id: secondTenant, load_id: secondLoad });
  });

  it('aborts on an existing cross-tenant link before adding the index or key', async () => {
    const dirty = new PGlite();
    try {
      await schema(dirty);
      await dirty.query('insert into public.fiscal_documents values($1,$2,$3)',
        [document, firstTenant, secondLoad]);
      await expect(dirty.exec(migration)).rejects.toThrow('fiscal_load_tenant_existing_link_invalid');
      expect((await dirty.query<{ index_exists: boolean; key_exists: boolean }>(`
        select to_regclass('public.loads_id_tenant_uidx') is not null index_exists,
          exists(select 1 from pg_constraint where conrelid='public.fiscal_documents'::regclass
            and conname='fiscal_documents_load_tenant_fkey') key_exists`)).rows[0])
        .toEqual({ index_exists: false, key_exists: false });
    } finally {
      await dirty.close();
    }
  });
});
