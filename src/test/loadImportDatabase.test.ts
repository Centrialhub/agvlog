// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyLoadImport, createLoadImportDatabase, loadImportIds as i, loadImportPayload, seedLoadImport,
} from './helpers/loadImportDatabase';

let db: PGlite;
const count = async (table: string) => (await db.query<{ count: number }>(`select count(*)::int count from ${table}`)).rows[0].count;

beforeAll(async () => { db = await createLoadImportDatabase(); }, 30_000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); await seedLoadImport(db); });
afterEach(async () => { await db.exec('rollback'); });

describe('canonical load import command', { timeout: 15_000 }, () => {
  it('commits the complete graph in assembling state and replays the exact response once', async () => {
    const payload = loadImportPayload();
    const first = await applyLoadImport(db, payload);
    const replay = await applyLoadImport(db, payload);
    expect(replay).toEqual(first);
    expect(first).toMatchObject({ confirmed: true, request_id: i.request, preview: { newLoads: 1, newDocuments: 1 } });
    expect(await count('public.load_import_batches')).toBe(1);
    expect(await count('private.load_import_commands')).toBe(1);
    expect(await count('public.load_documents')).toBe(1);
    expect(await count('public.load_items')).toBe(1);
    expect(await count('public.load_unloading_charges')).toBe(1);
    expect((await db.query("select status,invoice_count,total_weight_kg::float weight from loads where external_load_number='QA-IMPORT-1'")).rows[0])
      .toEqual({ status: 'assembling', invoice_count: 1, weight: 5 });
    expect((await db.query(`select
      has_function_privilege('authenticated','public.apply_load_import_command(jsonb)','execute') authenticated,
      has_function_privilege('anon','public.apply_load_import_command(jsonb)','execute') anon,
      has_function_privilege('service_role','public.apply_load_import_command(jsonb)','execute') service,
      has_table_privilege('authenticated','private.load_import_commands','select') ledger_read`)).rows[0])
      .toEqual({ authenticated: true, anon: false, service: false, ledger_read: false });
  });

  it('rejects a changed payload under the same request UUID without partial rows', async () => {
    const payload = loadImportPayload();
    await applyLoadImport(db, payload);
    await expect(applyLoadImport(db, { ...payload, file_name: 'changed.xlsx' })).rejects.toThrow('load_import_request_key_mismatch');
    expect(await count('private.load_import_commands')).toBe(1);
    expect(await count('public.load_import_batches')).toBe(1);
  });

  it('validates the complete batch and cross-tenant role before writing anything', async () => {
    const invalid = loadImportPayload({
      documents: [{ ...(loadImportPayload().documents[0] as Record<string, unknown>), external_load_number: 'MISSING' }],
    });
    await expect(applyLoadImport(db, invalid)).rejects.toThrow('load_import_unknown_load_reference');
    await expect(applyLoadImport(db, loadImportPayload({ tenant_id: i.otherTenant }))).rejects.toThrow('load_import_not_authorized');
    await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.driver]);
    await expect(applyLoadImport(db, loadImportPayload({ actor_id: i.driver }))).rejects.toThrow('load_import_not_authorized');
    expect(await count('public.load_import_batches')).toBe(0);
    expect(await count('public.load_documents')).toBe(0);
  });

  it('deduplicates documents, items, rates and unloading charges across distinct requests', async () => {
    await applyLoadImport(db, loadImportPayload());
    const second = await applyLoadImport(db, loadImportPayload({ request_id: 'd1100000-0000-4000-8000-000000000099' }));
    expect(second).toMatchObject({ preview: { updatedLoads: 1, newDocuments: 0, duplicated: 3 } });
    expect(await count('public.load_documents')).toBe(1);
    expect(await count('public.load_items')).toBe(1);
    expect(await count('public.load_unloading_charges')).toBe(1);
    expect(await count('public.load_import_batches')).toBe(2);
  });

  it('preserves status, revision and every financial projection of an existing paid load', async () => {
    const paid = loadImportPayload({
      loads: [{ external_load_number: 'PAID-1', load_date: '2026-09-01', arrival_date: null,
        gross_cargo_cents: 999999, freight_cents: 999999, cte_count: 0, legacy_status_text: 'reimport',
        expected_payment_date: '2026-12-31', closed_at: null }],
      documents: [], unloading_charges: [],
    });
    await applyLoadImport(db, paid);
    expect((await db.query('select status,operational_status,payment_status,freight_amount::float freight,received_amount::float received,payment_date,receivable_id,version from loads where id=$1', [i.paidLoad])).rows[0])
      .toMatchObject({ status: 'delivered', operational_status: 'delivered', payment_status: 'paid', freight: 100, received: 100, receivable_id: i.payment, version: 7 });
    expect(await count('public.load_payments')).toBe(1);
  });

  it('rolls every write back when a late unloading insert fails', async () => {
    await db.exec(`create function public.qa_reject_unload() returns trigger language plpgsql as $$begin raise exception 'qa_late_unload_failure';end;$$;
      create trigger qa_reject_unload before insert on public.load_unloading_charges for each row execute function public.qa_reject_unload();`);
    await expect(applyLoadImport(db, loadImportPayload())).rejects.toThrow('qa_late_unload_failure');
    expect(await count('public.load_import_batches')).toBe(0);
    expect(await count('private.load_import_commands')).toBe(0);
    expect(await count('public.load_documents')).toBe(0);
    expect(await count('public.load_items')).toBe(0);
    expect(await count('public.load_unloading_charges')).toBe(0);
    expect((await db.query("select count(*)::int count from loads where external_load_number='QA-IMPORT-1'")).rows[0]).toEqual({ count: 0 });
  });
});
