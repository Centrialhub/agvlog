import {expect, it, vi} from 'vitest';
import {submitPayableAction, type PayableAction} from '@/lib/financial/payableActions';

const api = vi.hoisted(() => ({rpc: vi.fn()}));
vi.mock('@/integrations/supabase/client', () => ({supabase: api}));

it.each(['payment', 'archive'] as const)('keeps the Supabase client context for %s', async action => {
  const base = {version: 1 as const, tenant_id: crypto.randomUUID(), request_id: crypto.randomUUID(), reason: 'Operação conferida'};
  const payableId = crypto.randomUUID();
  const command: PayableAction = action === 'payment'
    ? {...base, payable_id: payableId, bank_account_id: crypto.randomUUID(), amount_cents: 5000, paid_on: '2026-09-22', method: 'pix', bank_reference: ''}
    : {...base, items: [{payable_id: payableId, revision: 'a'.repeat(32)}]};
  const data = 'payable_id' in command
    ? {...base, confirmed: true, payable_id: payableId, bank_account_id: command.bank_account_id, amount_cents: '5000', paid_on: command.paid_on, payment_id: crypto.randomUUID(), movement_id: crypto.randomUUID()}
    : {...base, confirmed: true, payable_ids: [payableId]};
  api.rpc.mockImplementationOnce(function (this: unknown) {
    expect(this).toBe(api);
    return Promise.resolve({data, error: null});
  });
  await expect(submitPayableAction(command)).resolves.toMatchObject({confirmed: true});
  expect(api.rpc).toHaveBeenLastCalledWith(action === 'payment' ? 'pay_finance_payable_from_account' : 'archive_finance_payables', {_payload: command});
});
