// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createLoadControlPaginationDatabase,
  listLoadControlPage,
  loadControlIds as i,
  seedLoadControlPagination,
  setLoadControlActor,
} from './helpers/loadControlPaginationDatabase';

let db: PGlite;

beforeAll(async () => { ({ db } = await createLoadControlPaginationDatabase()); }, 40_000);
beforeEach(async () => {
  await db.exec('begin');
  await seedLoadControlPagination(db);
  await setLoadControlActor(db);
});
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });

describe('load-control keyset reader database contract', { timeout: 30_000 }, () => {
  it('walks more than 500 rows without a duplicate or missing load', async () => {
    const returned: string[] = [];
    let cursor: Record<string, unknown> | null = null;
    let pages = 0;
    do {
      const page = await listLoadControlPage(db, {}, 250, cursor);
      pages += 1;
      expect(page.total_count).toBe(625);
      returned.push(...page.items.map(row => String(row.id)));
      cursor = page.next_cursor;
    } while (cursor);

    expect(pages).toBe(3);
    expect(returned).toHaveLength(625);
    expect(new Set(returned).size).toBe(625);
    expect(returned[0]).toBe('70000000-0000-4000-8000-000000000625');
    expect(returned.at(-1)).toBe('70000000-0000-4000-8000-000000000001');
  });

  it('calculates exact counts and financial aggregates before paging', async () => {
    const page = await listLoadControlPage(db, {}, 25);
    expect(page.items).toHaveLength(25);
    expect(page.total_count).toBe(625);
    expect(page.summary).toMatchObject({
      paid: 156,
      unpaid: 313,
      overdue: 156,
      nfs: 1250,
      ctes: 625,
    });
    expect(Number(page.summary.freight)).toBe(258_125);
    expect(Number(page.summary.billed)).toBe(820_625);
  });

  it('applies filters before exact totals and pagination', async () => {
    const page = await listLoadControlPage(db, {
      loadNumber: 'LC-06',
      operationalStatus: 'delivered',
    }, 10);
    expect(page.total_count).toBe(13);
    expect(page.items).toHaveLength(10);
    expect(page.items.every(row => String(row.load_number).startsWith('LC-06'))).toBe(true);
    expect(page.items.every(row => row.operational_status === 'delivered')).toBe(true);
  });

  it('binds the cursor to the exact tenant and filter object', async () => {
    const first = await listLoadControlPage(db, { paymentStatus: 'unpaid' }, 10);
    await expect(listLoadControlPage(
      db,
      { paymentStatus: 'paid' },
      10,
      first.next_cursor,
    )).rejects.toThrow('load_control_list_invalid_cursor');
  });

  it('rejects another tenant instead of exposing its known load', async () => {
    await db.exec('savepoint cross_tenant_attempt');
    await expect(listLoadControlPage(db, {}, 10, null, i.otherTenant))
      .rejects.toThrow('load_control_list_not_authorized');
    await db.exec('rollback to savepoint cross_tenant_attempt');
    const own = await listLoadControlPage(db, {}, 250);
    expect(own.items.every(row => row.tenant_id === i.tenant)).toBe(true);
    expect(own.items.map(row => row.id)).not.toContain('79999999-0000-4000-8000-000000000001');
  });

  it('is an invoker reader exposed only to authenticated callers', async () => {
    await db.exec('reset role');
    const privileges = (await db.query<{
      public_exec: boolean;
      anon_exec: boolean;
      auth_exec: boolean;
      service_exec: boolean;
      definer: boolean;
    }>(`select
      has_function_privilege('public','public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)','execute') public_exec,
      has_function_privilege('anon','public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)','execute') anon_exec,
      has_function_privilege('authenticated','public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)','execute') auth_exec,
      has_function_privilege('service_role','public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)','execute') service_exec,
      prosecdef definer
      from pg_proc
      where oid='public.list_load_control_page_v2(uuid,jsonb,integer,jsonb)'::regprocedure`)).rows[0];
    expect(privileges).toEqual({
      public_exec: false,
      anon_exec: false,
      auth_exec: true,
      service_exec: false,
      definer: false,
    });
  });
});
