// @vitest-environment node
import { randomUUID } from 'node:crypto';
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createFinanceLedgerDatabase, financeAs, financeIds as i } from './helpers/financeLedgerDatabase';

let db: PGlite;
beforeAll(async () => { db = await createFinanceLedgerDatabase(); }, 30000);
beforeEach(async () => { await db.exec('begin'); });
afterEach(async () => { await db.exec('rollback'); });
afterAll(async () => { await db?.close(); });
const payload = (patch: Record<string, unknown> = {}) => ({
  version: 1, tenant_id: i.tenant, request_id: randomUUID(), bank_account_id: i.account,
  direction: 'out', nature: 'driver_advance', driver_id: i.driver, amount_cents: 50000,
  occurred_on: '2026-01-01', description: 'Envio para despesas da viagem',
  beneficiary_name: 'Motorista QA', reason: 'PIX realizado e registrado pelo financeiro', ...patch,
});
const record = async (p = payload(), actor = i.operator) =>
  (await financeAs<{ result: { movement_id: string; confirmed: boolean } }>(db, actor,
    'select public.record_finance_movement($1::jsonb) result', [JSON.stringify(p)])).rows[0].result;
const counts = async () => (await db.query<{movements:number;events:number;commands:number}>(`select
  (select count(*)::int from finance_movements) movements,
  (select count(*)::int from finance_events) events,
  (select count(*)::int from finance_commands) commands`)).rows[0];

describe('recorded movements independent of statement and expense evidence', () => {
  it('paginates records but aggregates the entire literal search filter on the server', async () => {
    for (let n = 0; n < 3; n++) await record(payload({ description: 'Viagem 100% confirmada', amount_cents: 10000 + n }));
    await record(payload({ description: 'Outra viagem', amount_cents: 99999 }));
    const list = (await financeAs<{ result: { total:number; outflow_cents:string; rows:unknown[] } }>(db, i.operator,
      'select list_finance_movements($1,$2::jsonb) result', [i.tenant, JSON.stringify({ search: '100%', page: 2, page_size: 1 })])).rows[0].result;
    expect(list).toMatchObject({ total: 3, outflow_cents: '30003' }); expect(list.rows).toHaveLength(1);
    await expect(financeAs(db, i.driverUser, 'select list_finance_movements($1)', [i.tenant])).rejects.toThrow('finance_access_denied');
  });
  it('records one R$500 advance and immutable server-authored evidence, without inventing expense categories', async () => {
    const p = payload(); const first = await record(p);
    expect(await record(p)).toEqual(first);
    expect(await counts()).toEqual({ movements: 1, events: 1, commands: 1 });
    expect((await db.query('select amount_cents::int,nature,direction,created_by from finance_movements')).rows[0])
      .toEqual({ amount_cents: 50000, nature: 'driver_advance', direction: 'out', created_by: i.operator });
    expect((await db.query('select actor_id,actor_name from finance_events')).rows[0])
      .toEqual({ actor_id: i.operator, actor_name: 'Financeiro QA' });
  });
  it('rejects a changed request body and duplicate external reference under a new request key', async () => {
    const p = payload({ bank_reference: 'PIX-REF-001' }); await record(p);
    await expect(record({ ...p, amount_cents: 60000 })).rejects.toThrow('finance_request_conflict');
    await expect(record(payload({ bank_reference: 'PIX-REF-001' }))).rejects.toThrow('finance_reference_already_recorded');
    expect(await counts()).toEqual({ movements: 1, events: 1, commands: 1 });
  });
  it('allows genuine same-value payments with distinct references', async () => {
    await record(payload({ bank_reference: 'PIX-1' })); await record(payload({ bank_reference: 'PIX-2' }));
    expect((await counts()).movements).toBe(2);
  });
  it('denies drivers both command access and reading their own financial movement', async () => {
    await record(); await expect(record(payload(), i.driverUser)).rejects.toThrow('finance_access_denied');
    expect((await financeAs(db, i.driverUser, 'select * from finance_movements')).rows).toEqual([]);
    expect((await financeAs(db, i.driverUser, 'select * from finance_events')).rows).toEqual([]);
    await db.query("insert into tenant_memberships values($1,$2,'operator',true)", [i.tenant, i.driverUser]);
    await expect(record(payload(), i.driverUser)).rejects.toThrow('finance_access_denied');
  });
  it('rejects inactive membership, another tenant bank account and another tenant payload', async () => {
    await expect(record(payload({ bank_account_id: i.otherAccount }))).rejects.toThrow('finance_invalid_account');
    await expect(record(payload({ tenant_id: i.otherTenant }))).rejects.toThrow('finance_access_denied');
    await db.query('update tenant_memberships set active=false where user_id=$1', [i.operator]);
    await expect(record()).rejects.toThrow('finance_access_denied');
    expect((await counts()).movements).toBe(0);
  });
  it('rolls back movement if audit or acknowledgement cannot commit', async () => {
    await db.exec(`create function fail_finance_command() returns trigger language plpgsql as $$
      begin raise exception 'simulated late failure';end;$$;
      create trigger fail_finance_command before insert on finance_commands for each row execute function fail_finance_command();`);
    await expect(record()).rejects.toThrow('simulated late failure');
    expect(await counts()).toEqual({ movements: 0, events: 0, commands: 0 });
  });
  it('rejects decimals, zero, future realized dates, cross-tenant attachment and spoofed author', async () => {
    for (const patch of [{ amount_cents: 1.5 }, { amount_cents: 0 }, { occurred_on: '2999-01-01' },
      { receipt_path: `${i.otherTenant}/receipt.pdf` }, { actor_id: i.driverUser }]) {
      await expect(record(payload(patch))).rejects.toThrow();
    }
    expect((await counts()).movements).toBe(0);
  });
  it('denies direct writes even for operators and preserves records against owner-level accidental edits', async () => {
    const result = await record();
    await expect(financeAs(db, i.operator, 'delete from finance_events')).rejects.toThrow('permission denied');
    await expect(financeAs(db, i.operator, 'update finance_movements set amount_cents=1')).rejects.toThrow('permission denied');
    await db.exec('savepoint owner_edit');
    await expect(db.query('delete from finance_movements where id=$1', [result.movement_id])).rejects.toThrow('finance_immutable_record');
    await db.exec('rollback to savepoint owner_edit');
  });
});
