// @vitest-environment node
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createDocumentChangeDatabase, documentChangeIds as i, seedDocumentChanges } from './helpers/documentChangesDatabase';
import { compositionRpc } from './helpers/compositionDatabase';

let db: PGlite;
beforeAll(async () => {
  db = await createDocumentChangeDatabase();
  await db.exec('alter table public.fiscal_documents add column if not exists current_delivery_attempt_id uuid');
  const migration = readFileSync('supabase/migrations/20260922195558_harden_complete_load_creation.sql', 'utf8');
  await db.exec(migration.slice(0, migration.indexOf('create table private.load_creation_commands')));
}, 40_000);
beforeEach(async () => { await seedDocumentChanges(db); });
afterAll(async () => { await db?.close(); });
const attach = () => compositionRpc(db, 'select public.assign_fiscal_documents_to_load_v2($1,$2,$3) result', [i.tenant, i.load, [i.doc3]]);

describe('issued invoice first operational assignment', () => {
  it.each(['cte_emitted_at', 'nfse_emitted_at'])('attaches an issued, confirmed, unassigned invoice preserving %s', async column => {
    await db.query(`update public.fiscal_documents set ${column}=now() where id=$1`, [i.doc3]);
    const before = (await db.query(`select ${column} from public.fiscal_documents where id=$1`, [i.doc3])).rows[0];
    await attach();
    expect((await db.query(`select ${column} from public.fiscal_documents where id=$1`, [i.doc3])).rows[0]).toEqual(before);
    expect((await db.query('select load_id from public.fiscal_documents where id=$1', [i.doc3])).rows[0]).toEqual({ load_id: i.load });
  });

  it('keeps issued notes with a previous delivery attempt blocked', async () => {
    await db.query('update public.fiscal_documents set cte_emitted_at=now(),current_delivery_attempt_id=$2 where id=$1', [i.doc3, i.doc]);
    await expect(attach()).rejects.toThrow('replanning_requires_fiscal_review');
  });

  it('preserves the authorized outbound reference during the first assignment', async () => {
    const outbound = '90000000-0000-4000-8000-000000000004';
    await db.query("insert into public.fiscal_documents(id,tenant_id,document_type,status) values($1,$2,'outbound','authorized')", [outbound, i.tenant]);
    await db.query('update public.fiscal_documents set cte_emitted_at=now(),cte_emitted_outbound_id=$2 where id=$1', [i.doc3, outbound]);
    await attach();
    expect((await db.query('select cte_emitted_outbound_id,load_id from public.fiscal_documents where id=$1', [i.doc3])).rows[0])
      .toEqual({ cte_emitted_outbound_id: outbound, load_id: i.load });
    expect((await db.query('select status from public.fiscal_documents where id=$1', [outbound])).rows[0]).toEqual({ status: 'authorized' });
  });

  it('rejects an outbound reference that belongs to another operational load', async () => {
    const outbound = '90000000-0000-4000-8000-000000000005';
    await db.query("insert into public.fiscal_documents(id,tenant_id,document_type,status,load_id) values($1,$2,'outbound','authorized',$3)", [outbound, i.tenant, i.load2]);
    await db.query('update public.fiscal_documents set cte_emitted_at=now(),cte_emitted_outbound_id=$2 where id=$1', [i.doc3, outbound]);
    await expect(attach()).rejects.toThrow('replanning_requires_fiscal_review');
  });

  it('keeps completed invoice statuses blocked', async () => {
    await db.query("update public.fiscal_documents set status='delivered',cte_emitted_at=now() where id=$1", [i.doc3]);
    await expect(attach()).rejects.toThrow('replanning_requires_fiscal_review');
  });

  it('does not permit detaching an issued invoice after the initial assignment', async () => {
    await db.query('update public.fiscal_documents set cte_emitted_at=now() where id=$1', [i.doc3]);
    await attach();
    await expect(compositionRpc(db, 'select public.remove_fiscal_documents_from_load_v2($1,$2,$3)', [i.tenant, i.load, [i.doc3]]))
      .rejects.toThrow('replanning_requires_fiscal_review');
  });
});
