// @vitest-environment node
// Regression coverage for the complete, atomic load creation command.
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createLoadAggregateDatabase, loadAggregateIds as i } from './helpers/loadAggregateDatabase';

let db: PGlite;
const firstDoc = '90000000-0000-4000-8000-000000000001';
const secondDoc = '90000000-0000-4000-8000-000000000002';
beforeAll(async () => {
  db = await createLoadAggregateDatabase();
  await db.exec(`
    grant usage on schema auth to authenticated;
    alter table public.vehicles add column max_pallets numeric default 1;
    alter table public.fiscal_documents add column document_type text default 'inbound',
      add column deleted_at timestamptz, add column pallet_count numeric default 1,
      add column invoice_number text, add column client_id uuid, add column recipient text,
      add column recipient_neighborhood text, add column recipient_city text,
      add column cte_emitted_at timestamptz, add column cte_emitted_outbound_id uuid,
      add column nfse_emitted_at timestamptz, add column status text default 'confirmed',
      add column updated_at timestamptz default now();
    create table public.clients(id uuid primary key,tenant_id uuid);
    create function public.is_tenant_operator_or_admin(uuid) returns boolean language sql as $$
      select exists(select 1 from public.tenant_memberships where tenant_id=$1
        and user_id=auth.uid() and active and role::text in ('owner','admin','operator'))
    $$;
    -- Only the downstream assignment is simplified. Aggregate/idempotency and
    -- both production creation wrappers run their real SQL definitions.
    create function public.assign_fiscal_documents_to_load_v2(uuid,uuid,uuid[]) returns jsonb
      language plpgsql as $$begin
        if current_setting('fixture.fail_attachment',true)='yes' then raise exception 'fixture_attachment_failed'; end if;
        if exists(select 1 from public.fiscal_documents where id=any($3) and load_id is not null and load_id<>$2)
          then raise exception 'document_already_linked'; end if;
        update public.fiscal_documents set load_id=$2 where tenant_id=$1 and id=any($3);
        return '{"ok":true}'::jsonb;
      end$$;
    grant select,update on public.fiscal_documents, public.vehicles to authenticated;
    grant select on public.tenant_memberships to authenticated;
  `);
  await db.exec(readFileSync('supabase/migrations/20260922192742_fix_grouped_load_initial_status.sql', 'utf8'));
  const sql = readFileSync('supabase/migrations/20260916231000_finish_reported_integrity_fixes.sql', 'utf8');
  const start = sql.indexOf('create or replace function public.create_load_with_documents_v1');
  const endMarker = 'grant execute on function public.create_load_with_documents_v1(jsonb) to authenticated;';
  await db.exec(sql.slice(start, sql.indexOf(endMarker, start) + endMarker.length));
  const composition = readFileSync('supabase/migrations/20260830085557_harden_document_composition_changes.sql', 'utf8');
  const compositionStart = composition.indexOf('create function public._change_load_documents(');
  await db.exec(composition.slice(compositionStart, composition.indexOf('$fn$;', compositionStart) + 5));
  await db.exec(readFileSync('supabase/migrations/20260922195558_harden_complete_load_creation.sql', 'utf8'));
}, 40_000);
beforeEach(async () => {
  await db.exec('begin');
  await db.query("select set_config('request.jwt.claim.sub',$1,false)", [i.operator]);
  await db.query('insert into public.fiscal_documents(id,tenant_id) values($1,$3),($2,$3)', [firstDoc, secondDoc, i.tenant]);
});
afterEach(async () => { await db.exec('rollback;reset role'); });
afterAll(async () => { await db?.close(); });

const payload = () => ({
  tenant_id: i.tenant, request_id: randomUUID(),
  changes: { destination: 'ROTA - SALINAS', vehicle_id: i.vehicle, driver_id: null },
});
async function call(rpc: string, command: unknown) {
  await db.exec('set role authenticated');
  const result = (await db.query<{ result: Record<string, unknown> }>(
    `select public.${rpc}($1::jsonb) result`, [JSON.stringify(command)],
  )).rows[0].result;
  await db.exec('reset role');
  return result;
}

describe('complete load creation command', () => {
  it('rejects duplicate notes without leaving a load or a recovery command', async () => {
    await db.exec('savepoint duplicate_notes');
    await expect(call('create_grouped_load_v1', { ...payload(), document_ids: [firstDoc, firstDoc] }))
      .rejects.toThrow('invalid_document_selection');
    await db.exec('rollback to savepoint duplicate_notes;reset role');
    expect((await db.query('select count(*)::int n from public.loads')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int n from private.load_creation_commands')).rows).toEqual([{ n: 0 }]);
  });

  it('rejects a grouped load above vehicle pallet capacity atomically', async () => {
    await db.exec('savepoint over_capacity');
    await expect(call('create_grouped_load_v1', { ...payload(), document_ids: [firstDoc, secondDoc] }))
      .rejects.toThrow('vehicle_pallet_capacity_exceeded');
    await db.exec('rollback to savepoint over_capacity;reset role');
    expect((await db.query('select count(*)::int n from public.loads')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int n from public.fiscal_documents where load_id is not null')).rows).toEqual([{ n: 0 }]);
  });

  it('rejects changed documents under a replay and preserves vehicle capacity', async () => {
    const command = { ...payload(), document_ids: [firstDoc] };
    const first = await call('create_grouped_load_v1', command);
    await db.exec('savepoint mismatch');
    await expect(call('create_grouped_load_v1', { ...command, document_ids: [secondDoc] })).rejects.toThrow('request_payload_mismatch');
    await db.exec('rollback to savepoint mismatch;reset role');
    expect((await db.query('select sum(pallet_count)::int pallets from public.fiscal_documents where load_id=$1', [first.load_id])).rows)
      .toEqual([{ pallets: 1 }]);
  });

  it('rejects a New Load replay with a different document', async () => {
    const command = { ...payload(), selected_document_ids: [firstDoc] };
    const first = await call('create_load_with_documents_v1', command);
    await db.exec('savepoint mismatch');
    await expect(call('create_load_with_documents_v1', { ...command, selected_document_ids: [secondDoc] })).rejects.toThrow('request_payload_mismatch');
    await db.exec('rollback to savepoint mismatch;reset role');
    expect((await db.query('select count(*)::int n from public.fiscal_documents where load_id=$1', [first.load_id])).rows)
      .toEqual([{ n: 1 }]);
  });

  it('rejects a New Load replay that changes invoice metadata', async () => {
    const command = { ...payload(), selected_document_ids: [firstDoc], single_document_patch: { invoice_number: '111' } };
    await call('create_load_with_documents_v1', command);
    await db.exec('savepoint mismatch');
    await expect(call('create_load_with_documents_v1', { ...command, single_document_patch: { invoice_number: '222' } })).rejects.toThrow('request_payload_mismatch');
    await db.exec('rollback to savepoint mismatch;reset role');
    expect((await db.query('select invoice_number from public.fiscal_documents where id=$1', [firstDoc])).rows)
      .toEqual([{ invoice_number: '111' }]);
  });

  it('recovers the original confirmation after a lost response without reassigning notes', async () => {
    const command = { ...payload(), document_ids: [firstDoc] };
    const first = await call('create_grouped_load_v1', command);
    const replay = await call('create_grouped_load_v1', command);
    expect(replay).toEqual({ ...first, replayed: true });
    expect((await db.query('select count(*)::int n from public.loads')).rows).toEqual([{ n: 1 }]);
  });

  it('accepts planned from existing browsers and replays after the frontend omits it', async () => {
    const command = { ...payload(), document_ids: [firstDoc] };
    const first = await call('create_grouped_load_v1', { ...command, changes: { ...command.changes, status: 'planned' } });
    expect(await call('create_grouped_load_v1', command)).toEqual({ ...first, replayed: true });
  });

  it('preserves issued invoice metadata even if an older screen sends an autofill patch', async () => {
    await db.query("update public.fiscal_documents set invoice_number='111',cte_emitted_at=now() where id=$1", [firstDoc]);
    await call('create_load_with_documents_v1', { ...payload(), selected_document_ids: [firstDoc], single_document_patch: { invoice_number: '222' } });
    expect((await db.query('select invoice_number from public.fiscal_documents where id=$1', [firstDoc])).rows).toEqual([{ invoice_number: '111' }]);
  });

  it('rejects metadata clients from another company', async () => {
    await db.query('insert into public.clients values($1,$2)', [i.otherDriver, i.otherTenant]);
    await expect(call('create_load_with_documents_v1', { ...payload(), selected_document_ids: [firstDoc], single_document_patch: { client_id: i.otherDriver } }))
      .rejects.toThrow('invalid_client_for_tenant');
  });

  it('rejects another tenant and unauthenticated callers', async () => {
    await db.exec('savepoint auth_check');
    await expect(call('create_grouped_load_v1', { ...payload(), tenant_id: i.otherTenant, document_ids: [firstDoc] })).rejects.toThrow('operator_required');
    await db.exec('rollback to savepoint auth_check;reset role');
    await db.query("select set_config('request.jwt.claim.sub','',false)");
    await expect(call('create_grouped_load_v1', { ...payload(), document_ids: [firstDoc] })).rejects.toThrow('tenant_actor_request_required');
  });

  it('does not leave a header or recovery ledger when the document writer fails', async () => {
    await db.query("select set_config('fixture.fail_attachment','yes',true)");
    await db.exec('savepoint failure');
    await expect(call('create_grouped_load_v1', { ...payload(), document_ids: [firstDoc] })).rejects.toThrow('fixture_attachment_failed');
    await db.exec('rollback to savepoint failure;reset role');
    expect((await db.query('select count(*)::int n from public.loads')).rows).toEqual([{ n: 0 }]);
    expect((await db.query('select count(*)::int n from private.load_creation_commands')).rows).toEqual([{ n: 0 }]);
  });

  it('does not expose the ledger or internal implementation to clients', async () => {
    expect((await db.query(`select
      has_table_privilege('authenticated','private.load_creation_commands','select,insert,update,delete') ledger,
      has_function_privilege('authenticated','private.create_grouped_load_v1_impl(jsonb)','execute') implementation,
      has_function_privilege('anon','private.create_complete_load(text,jsonb)','execute') anonymous`)).rows)
      .toEqual([{ ledger: false, implementation: false, anonymous: false }]);
  });
});
