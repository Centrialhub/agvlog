// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { operationIds as i } from './helpers/operationOutcomeDatabase';
import {
  createOperatorEventPaginationDatabase,
  listOperatorEventPage,
} from './helpers/operatorEventPaginationDatabase';

let db: PGlite;
beforeAll(async () => { ({ db } = await createOperatorEventPaginationDatabase()); }, 40_000);
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
});
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });

async function addEvents(count: number, tenant = i.tenant) {
  const ids: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const id = randomUUID();
    ids.push(id);
    await db.query(`insert into public.operational_events(
      id,tenant_id,event_type,severity,description,created_at,updated_at,
      visible_to_client,client_action_required,client_opened,public_status
    ) values($1,$2,$3,$4,$5,$6,$6,false,false,false,'reported_by_operator')`, [
      id,
      tenant,
      index % 2 === 0 ? 'missing_goods' : 'delivery_delay',
      index % 2 === 0 ? 'high' : 'low',
      `Ocorrência paginada ${index}`,
      `2026-09-01T${String(10 + index).padStart(2, '0')}:00:00Z`,
    ]);
  }
  return ids;
}

describe('operator event cursor reader database contract', () => {
  it('walks every row in stable keyset order and confirms the end', async () => {
    const ids = await addEvents(5);
    const first = await listOperatorEventPage(db, { status: 'all', search: 'paginada' });
    const second = await listOperatorEventPage(db, { status: 'all', search: 'paginada' }, 2, first.next_cursor);
    const third = await listOperatorEventPage(db, { status: 'all', search: 'paginada' }, 2, second.next_cursor);
    const returned = [...first.items, ...second.items, ...third.items].map(row => row.id);

    expect(first.items).toHaveLength(2);
    expect(second.items).toHaveLength(2);
    expect(third.items).toHaveLength(1);
    expect(third.next_cursor).toBeNull();
    expect(new Set(returned)).toEqual(new Set(ids));
    expect(new Set(returned).size).toBe(5);
  });

  it('binds a cursor to the exact tenant and filters', async () => {
    await addEvents(3);
    const first = await listOperatorEventPage(db, { status: 'all' }, 2);
    await expect(listOperatorEventPage(db, { status: 'open' }, 2, first.next_cursor))
      .rejects.toThrow('operational_event_list_invalid_cursor');
  });

  it('does not move the next page when a newer event arrives', async () => {
    await addEvents(4);
    const first = await listOperatorEventPage(db, { status: 'all', search: 'paginada' }, 2);
    const newId = randomUUID();
    await db.query(`insert into public.operational_events(
      id,tenant_id,event_type,severity,description,created_at,updated_at,
      visible_to_client,client_action_required,client_opened,public_status
    ) values($1,$2,'other','medium','Ocorrência paginada nova','2026-09-01T23:00:00Z','2026-09-01T23:00:00Z',false,false,false,'reported_by_operator')`, [newId, i.tenant]);
    const second = await listOperatorEventPage(db, { status: 'all', search: 'paginada' }, 2, first.next_cursor);

    expect(second.items.map(row => row.id)).not.toContain(newId);
    expect(new Set([...first.items, ...second.items].map(row => row.id)).size).toBe(4);
  });

  it('applies responsibility and text filters before pagination', async () => {
    await addEvents(4);
    const warehouse = await listOperatorEventPage(db, {
      status: 'all',
      responsibility: 'deposito',
      search: 'paginada',
    }, 10);
    expect(warehouse.items).toHaveLength(2);
    expect(warehouse.items.every(row => row.event_type === 'missing_goods')).toBe(true);
  });

  it('rejects another tenant and never returns its rows', async () => {
    await addEvents(2);
    await addEvents(1, i.otherTenant);
    const own = await listOperatorEventPage(db, { status: 'all', search: 'paginada' }, 10);
    expect(own.items).toHaveLength(2);
    expect(own.items.every(row => row.tenant_id === i.tenant)).toBe(true);
    await expect(listOperatorEventPage(db, { status: 'all' }, 10, null, i.otherTenant))
      .rejects.toThrow('operational_event_list_not_authorized');
  });

  it('is an invoker reader exposed only to authenticated callers', async () => {
    expect((await db.query<{ public_exec: boolean; anon_exec: boolean; auth_exec: boolean; definer: boolean }>(`select
      has_function_privilege('public','public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)','execute') public_exec,
      has_function_privilege('anon','public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)','execute') anon_exec,
      has_function_privilege('authenticated','public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)','execute') auth_exec,
      prosecdef definer from pg_proc where oid='public.list_operational_events_page_v1(uuid,jsonb,integer,jsonb)'::regprocedure`)).rows[0])
      .toEqual({ public_exec: false, anon_exec: false, auth_exec: true, definer: false });
  });
});
