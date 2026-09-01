// @vitest-environment node
import type { PGlite } from '@electric-sql/pglite';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  applyLoadPayment,
  createLoadPaymentDatabase,
  loadPaymentIds as i,
  loadPaymentPayload,
  seedLoadPayment,
} from './helpers/loadPaymentDatabase';

let db: PGlite;
const count = async (table: string) => (await db.query<{ count: number }>(`select count(*)::int count from ${table}`)).rows[0].count;

beforeAll(async () => { ({ db } = await createLoadPaymentDatabase()); }, 30000);
afterAll(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('begin'); await seedLoadPayment(db); });
afterEach(async () => { await db.exec('rollback'); });

describe('canonical load payment command', { timeout: 15000 }, () => {
  it('updates bank ledger, receivable, load mirror and history atomically, then replays exactly once', async () => {
    const payload = await loadPaymentPayload(db);
    const historyBefore = await count('public.load_status_history');
    const first = await applyLoadPayment(db, payload);
    const replay = await applyLoadPayment(db, payload);
    await db.exec('set constraints all immediate');
    expect(replay).toEqual(first);
    expect(first).toMatchObject({
      confirmed: true, request_id: i.request, load_id: i.load, receivable_id: i.receivable,
      amount_cents: 2500, received_cents: 2500, open_cents: 7500, payment_status: 'partially_paid',
    });
    expect(await count('public.bank_transactions')).toBe(1);
    expect(await count('public.receivables_payments')).toBe(1);
    expect(await count('public.load_payments')).toBe(1);
    expect(await count('private.load_payment_commands')).toBe(1);
    expect(await count('public.load_status_history')).toBe(historyBefore + 2);
    expect((await db.query('select received_amount::float received,status from receivables where id=$1', [i.receivable])).rows[0]).toEqual({ received: 25, status: 'partial' });
    expect((await db.query('select received_amount::float received,payment_status,version from loads where id=$1', [i.load])).rows[0]).toEqual({ received: 25, payment_status: 'partially_paid', version: 2 });
  });

  it('rejects a changed payload under the same request UUID without another ledger row', async () => {
    const payload = await loadPaymentPayload(db);
    await applyLoadPayment(db, payload);
    await expect(applyLoadPayment(db, { ...payload, amount_cents: 2600 })).rejects.toThrow('load_payment_request_key_mismatch');
    expect(await count('public.bank_transactions')).toBe(1);
    expect(await count('public.load_payments')).toBe(1);
  });

  it.each([
    ['zero amount', { amount_cents: 0 }, 'load_payment_invalid_command'],
    ['negative amount', { amount_cents: -1 }, 'load_payment_invalid_command'],
    ['amount above open balance', { amount_cents: 10001 }, 'load_payment_amount_exceeds_open_balance'],
    ['foreign bank account', { bank_account_id: i.otherBank }, 'load_payment_invalid_bank_account'],
    ['wrong receivable', { receivable_id: i.load }, 'load_payment_invalid_receivable_link'],
    ['actor mismatch', { actor_id: i.user }, 'load_payment_not_authorized'],
  ])('rejects %s before writing anything', async (_label, patch, message) => {
    await expect(applyLoadPayment(db, await loadPaymentPayload(db, patch))).rejects.toThrow(message);
    expect(await count('public.bank_transactions')).toBe(0);
    expect(await count('public.receivables_payments')).toBe(0);
    expect(await count('public.load_payments')).toBe(0);
    expect(await count('private.load_payment_commands')).toBe(0);
  });

  it('rejects a non-operational membership even with matching actor claims', async () => {
    await db.query("update tenant_memberships set role='driver' where tenant_id=$1 and user_id=$2", [i.tenant, i.operator]);
    await expect(applyLoadPayment(db, await loadPaymentPayload(db))).rejects.toThrow('load_payment_not_authorized');
    expect(await count('public.bank_transactions')).toBe(0);
  });

  it('rejects cancelled load state and keeps canonical payment evidence immutable', async () => {
    await db.query("update loads set payment_status='cancelled' where tenant_id=$1 and id=$2", [i.tenant, i.load]);
    await expect(applyLoadPayment(db, await loadPaymentPayload(db))).rejects.toThrow('load_payment_cancelled_load');
    await db.query("update loads set payment_status='unpaid' where tenant_id=$1 and id=$2", [i.tenant, i.load]);
    await applyLoadPayment(db, await loadPaymentPayload(db));
    await expect(db.query("update load_payments set notes='tamper' where tenant_id=$1 and load_id=$2", [i.tenant, i.load])).rejects.toThrow('canonical_load_payment_is_immutable');
  });

  it('rolls the financial command and every projection back when history fails late', async () => {
    await db.exec(`
      create function public.qa_reject_load_payment_history() returns trigger language plpgsql as $$
      begin raise exception 'qa_late_history_failure'; end;$$;
      create trigger qa_reject_load_payment_history before insert on public.load_status_history
      for each row execute function public.qa_reject_load_payment_history();
    `);
    await expect(applyLoadPayment(db, await loadPaymentPayload(db))).rejects.toThrow('qa_late_history_failure');
    expect(await count('public.bank_transactions')).toBe(0);
    expect(await count('public.receivables_payments')).toBe(0);
    expect(await count('public.receivable_financial_commands')).toBe(0);
    expect(await count('public.load_payments')).toBe(0);
    expect(await count('private.load_payment_commands')).toBe(0);
    expect((await db.query('select received_amount::float received,payment_status,version from loads where id=$1', [i.load])).rows[0]).toEqual({ received: 0, payment_status: 'unpaid', version: 1 });
  });
});
