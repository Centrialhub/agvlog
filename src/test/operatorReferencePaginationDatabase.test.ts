// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  createOperatorReferencePaginationDatabase,
  listOperatorClientsPage,
  listOperatorReferencePage,
  operatorReferenceIds as ids,
  seedOperatorReferencePagination,
  setOperatorReferenceActor,
} from './helpers/operatorReferencePaginationDatabase';

describe('operator reference cursor reader database contract', { timeout: 30_000 }, () => {
  let db: PGlite;

  beforeAll(async () => {
    db = await createOperatorReferencePaginationDatabase();
    await seedOperatorReferencePagination(db);
  });
  beforeEach(async () => {
    await db.exec('begin');
    await setOperatorReferenceActor(db);
  });
  afterEach(async () => { await db.exec('rollback'); });
  afterAll(async () => { await db.close(); });

  it('walks more than the Data API cap without gaps or duplicate tie keys', async () => {
    const first = await listOperatorReferencePage(db, 'loads');
    const second = await listOperatorReferencePage(db, 'loads', false, 500, first.next_cursor);

    expect(first.items).toHaveLength(500);
    expect(second.items).toHaveLength(1);
    expect(second.next_cursor).toBeNull();
    const all = [...first.items, ...second.items];
    expect(new Set(all.map(row => row.id)).size).toBe(501);
    expect(all.every(row => row.tenant_id === ids.tenant)).toBe(true);
  });

  it('paginates the client registry bidirectionally without OFFSET', async () => {
    await db.exec('reset role');
    await db.query(`
      insert into public.clients(
        id, tenant_id, company_name, active, is_client, is_supplier, created_at, updated_at
      )
      select
        ('33100000-0000-4000-8000-' || lpad(series::text, 12, '0'))::uuid,
        $1::uuid,
        'Empresa-' || lpad(series::text, 3, '0'),
        true,
        true,
        false,
        timestamptz '2026-02-01 00:00:00+00' + series * interval '1 minute',
        timestamptz '2026-02-01 00:00:00+00'
      from generate_series(1, 121) series
    `, [ids.tenant]);
    await setOperatorReferenceActor(db);

    const first = await listOperatorClientsPage(db, { search: 'Empresa-', limit: 50 });
    const second = await listOperatorClientsPage(db, {
      search: 'Empresa-', limit: 50, cursor: first.next_cursor,
    });
    const last = await listOperatorClientsPage(db, {
      search: 'Empresa-', limit: 50, direction: 'previous', snapshotAt: first.snapshot_at,
    });

    expect(first.total_count).toBe(121);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(50);
    expect(last.items).toHaveLength(21);
    expect(first.items[0].company_name).toBe('Empresa-001');
    expect(second.items[0].company_name).toBe('Empresa-051');
    expect(last.items[0].company_name).toBe('Empresa-101');
    expect(last.previous_cursor).not.toBeNull();
    expect(last.next_cursor).toBeNull();

    await db.exec('reset role');
    const contract = await db.query<{ definition: string; cursor_index: boolean }>(`
      select
        pg_get_functiondef('public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)'::regprocedure) definition,
        to_regclass('public.clients_tenant_name_cursor_idx') is not null cursor_index
    `);
    expect(contract.rows[0].definition).not.toMatch(/\boffset\b/i);
    expect(contract.rows[0].cursor_index).toBe(true);
    await setOperatorReferenceActor(db);
  });

  it('binds the cursor to resource, tenant and active scope', async () => {
    const first = await listOperatorReferencePage(db, 'loads', false, 2);
    await db.exec('savepoint wrong_resource');
    await expect(listOperatorReferencePage(db, 'clients', false, 2, first.next_cursor))
      .rejects.toThrow('operator_reference_list_invalid_cursor');
    await db.exec('rollback to savepoint wrong_resource');
    await db.exec('savepoint wrong_scope');
    await expect(listOperatorReferencePage(db, 'loads', true, 2, first.next_cursor))
      .rejects.toThrow('operator_reference_list_invalid_cursor');
    await db.exec('rollback to savepoint wrong_scope');
    await db.exec('savepoint wrong_tenant');
    await expect(listOperatorReferencePage(db, 'loads', false, 2, first.next_cursor, ids.otherTenant))
      .rejects.toThrow('operator_reference_list_not_authorized');
    await db.exec('rollback to savepoint wrong_tenant');
  });

  it('binds client cursors to the search and rejects unrelated actors', async () => {
    const first = await listOperatorClientsPage(db, { search: 'Cliente', limit: 1 });
    await db.exec('savepoint wrong_client_search');
    await expect(listOperatorClientsPage(db, {
      search: 'Outro', limit: 1, cursor: first.next_cursor,
    })).rejects.toThrow('operator_clients_list_invalid_cursor');
    await db.exec('rollback to savepoint wrong_client_search');

    await setOperatorReferenceActor(db, ids.outsider);
    await expect(listOperatorClientsPage(db)).rejects.toThrow('operator_clients_list_not_authorized');
  });

  it('enforces active scope and never returns a vehicle tracker password', async () => {
    expect((await listOperatorReferencePage(db, 'clients')).items.map(row => row.company_name))
      .toEqual(['Cliente ativo']);
    const drivers = (await listOperatorReferencePage(db, 'drivers', true)).items;
    expect(drivers).toHaveLength(2);
    expect(drivers.find(row => row.name === 'Motorista ativo')?.current_vehicle).toEqual({
      id: '35000000-0000-4000-8000-000000000001',
      nickname: 'Seguro',
      plate: 'AAA1A11',
    });
    const vehicles = (await listOperatorReferencePage(db, 'vehicles', true)).items;
    expect(vehicles).toHaveLength(2);
    expect(vehicles.every(row => !('tracker_password' in row))).toBe(true);
    expect(vehicles.find(row => row.plate === 'AAA1A11')?.current_driver).toEqual({
      id: '34000000-0000-4000-8000-000000000001',
      name: 'Motorista ativo',
    });
    expect((await listOperatorReferencePage(db, 'operational_routes')).items.map(row => row.name))
      .toEqual(['Rota ativa']);
  });

  it('rejects anonymous, inactive and unrelated actors before reading rows', async () => {
    await setOperatorReferenceActor(db, ids.outsider);
    await expect(listOperatorReferencePage(db, 'loads')).rejects.toThrow('operator_reference_list_not_authorized');
  });

  it('exposes only the new invoker reader to authenticated callers', async () => {
    const result = await db.query<{
      public_reader: boolean;
      anon_reader: boolean;
      new_reader: boolean;
      service_reader: boolean;
      client_reader: boolean;
      anon_client_reader: boolean;
      client_definer: boolean;
      definer: boolean;
      legacy_loads: boolean;
      legacy_clients: boolean;
      legacy_drivers: boolean;
      legacy_routes: boolean;
      legacy_fiscal: boolean;
      legacy_next_number: boolean;
      service_legacy: boolean;
    }>(`
      select
        has_function_privilege('public','public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)','execute') public_reader,
        has_function_privilege('anon','public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)','execute') anon_reader,
        has_function_privilege('authenticated','public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)','execute') new_reader,
        has_function_privilege('service_role','public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)','execute') service_reader,
        has_function_privilege('authenticated','public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)','execute') client_reader,
        has_function_privilege('anon','public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)','execute') anon_client_reader,
        (select prosecdef from pg_proc where oid='public.list_operator_clients_page_v1(uuid,text,text,integer,jsonb,text,timestamptz)'::regprocedure) client_definer,
        (select prosecdef from pg_proc where oid='public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)'::regprocedure) definer,
        has_function_privilege('authenticated','public.list_loads_v1(uuid,text,text[],timestamptz,integer)','execute') legacy_loads,
        has_function_privilege('authenticated','public.list_clients_v1(uuid,text,text,integer)','execute') legacy_clients,
        has_function_privilege('authenticated','public.list_drivers_v1(uuid,text,text,integer)','execute') legacy_drivers,
        has_function_privilege('authenticated','public.list_operational_routes_v1(uuid,text,text,integer)','execute') legacy_routes,
        has_function_privilege('authenticated','public.list_fiscal_documents_v1(uuid,text,text[],timestamptz,integer)','execute') legacy_fiscal,
        has_function_privilege('authenticated','public.get_next_load_number_v1(uuid)','execute') legacy_next_number,
        has_function_privilege('service_role','public.list_loads_v1(uuid,text,text[],timestamptz,integer)','execute') service_legacy
    `);
    expect(result.rows[0]).toEqual({
      public_reader: false,
      anon_reader: false,
      new_reader: true,
      service_reader: false,
      client_reader: true,
      anon_client_reader: false,
      client_definer: false,
      definer: false,
      legacy_loads: false,
      legacy_clients: false,
      legacy_drivers: false,
      legacy_routes: false,
      legacy_fiscal: false,
      legacy_next_number: false,
      service_legacy: true,
    });
  });
});

it('installs when an environment already retired every legacy overload', { timeout: 30_000 }, async () => {
  const db = await createOperatorReferencePaginationDatabase({ legacy: false });
  try {
    const result = await db.query<{ installed: boolean }>(`
      select to_regprocedure('public.list_operator_reference_page_v1(uuid,text,boolean,integer,jsonb)') is not null installed
    `);
    expect(result.rows[0].installed).toBe(true);
  } finally {
    await db.close();
  }
});
