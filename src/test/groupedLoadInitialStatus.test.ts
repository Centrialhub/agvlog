// @vitest-environment node
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLoadAggregateDatabase, loadAggregateIds as i } from './helpers/loadAggregateDatabase';

let db: PGlite;
const documentId = '90000000-0000-4000-8000-000000000001';
const migration = readFileSync('supabase/migrations/20260922192742_fix_grouped_load_initial_status.sql', 'utf8');

beforeAll(async () => {
  db = await createLoadAggregateDatabase();
  await db.exec(`
    grant usage on schema auth to authenticated;
    alter table public.vehicles add column max_pallets numeric;
    alter table public.fiscal_documents add column document_type text default 'inbound',
      add column deleted_at timestamptz, add column pallet_count numeric default 1;
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$
      select exists(select 1 from public.tenant_memberships where tenant_id=$1
        and user_id=auth.uid() and active and role::text in ('owner','admin','operator'))
    $$;
    -- Fixture for the downstream document writer; the aggregate writer is real.
    create function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]) returns jsonb
      language plpgsql as $$begin
        if exists(select 1 from public.fiscal_documents where id=any($3) and load_id is not null and load_id<>$2)
          then raise exception 'document_already_assigned'; end if;
        update public.fiscal_documents set load_id=$2 where tenant_id=$1 and id=any($3);
        return '{"ok":true}'::jsonb;
      end$$;
    grant select,update on public.fiscal_documents, public.vehicles to authenticated;
    grant select on public.tenant_memberships to authenticated;
  `);
  await db.exec(migration);
}, 40_000);
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
  await db.query('insert into public.fiscal_documents(id,tenant_id) values($1,$2)', [documentId, i.tenant]);
});
afterEach(async () => { await db.exec('rollback;reset role'); });
afterAll(async () => { await db?.close(); });

const payload = (changes: Record<string, unknown> = {}) => ({
  tenant_id: i.tenant, request_id: randomUUID(), document_ids: [documentId],
  changes: { destination: 'ROTA - SALINAS', vehicle_id: null, driver_id: null, ...changes },
});
async function create(command: ReturnType<typeof payload>) {
  await db.exec('set role authenticated');
  const result = (await db.query<{ result: Record<string, unknown> }>(
    'select public.create_grouped_load_v1($1::jsonb) result', [JSON.stringify(command)],
  )).rows[0].result;
  await db.exec('reset role');
  return result;
}

describe('grouped load creation initial status compatibility', () => {
  it.each([{}, { status: 'planned' }])('creates and attaches documents for changes %j', async changes => {
    const result = await create(payload(changes));
    expect(result).toMatchObject({ ok: true, document_count: 1, pallet_count: 1 });
    expect((await db.query('select status,destination from public.loads where id=$1', [result.load_id])).rows)
      .toEqual([{ status: 'planned', destination: 'ROTA - SALINAS' }]);
    expect((await db.query('select load_id from public.fiscal_documents where id=$1', [documentId])).rows)
      .toEqual([{ load_id: result.load_id }]);
  });

  it('replays the same request across legacy and updated clients without creating another load', async () => {
    const command = payload({ status: 'planned' });
    const first = await create(command);
    const replay = await create({ ...command, changes: payload().changes });
    expect(replay).toMatchObject({ load_id: first.load_id, replayed: true });
    expect((await db.query('select count(*)::int n from public.loads')).rows).toEqual([{ n: 1 }]);
  });

  it.each(['in_transit', 'delivered', 'cancelled', null])('rejects client-owned status %j', async status => {
    await expect(create(payload({ status }))).rejects.toThrow('unsupported_load_fields:status');
  });

  it('continues rejecting unrelated unsupported fields', async () => {
    await expect(create(payload({ status: 'planned', total_pallet_count: 99 })))
      .rejects.toThrow('unsupported_load_fields:total_pallet_count');
  });

  it('preserves vehicle capacity validation', async () => {
    await db.query('update public.vehicles set max_pallets=0.5 where id=$1', [i.vehicle]);
    await expect(create(payload({ status: 'planned', vehicle_id: i.vehicle })))
      .rejects.toThrow('vehicle_pallet_capacity_exceeded');
  });

  it('rejects an operator from a different tenant', async () => {
    await expect(create({ ...payload({ status: 'planned' }), tenant_id: i.otherTenant }))
      .rejects.toThrow('operator_required');
  });

  it('rolls back the load if document attachment fails', async () => {
    await create(payload());
    await db.exec('savepoint retry');
    await expect(create(payload({ status: 'planned' }))).rejects.toThrow('document_already_assigned');
    await db.exec('rollback to savepoint retry;reset role');
    expect((await db.query('select count(*)::int n from public.loads')).rows).toEqual([{ n: 1 }]);
  });

  it('retains invoker security and blocks anonymous callers', async () => {
    expect((await db.query(`select prosecdef, has_function_privilege('anon',oid,'execute') anonymous
      from pg_proc where oid='public.create_grouped_load_v1(jsonb)'::regprocedure`)).rows)
      .toEqual([{ prosecdef: false, anonymous: false }]);
  });
});
