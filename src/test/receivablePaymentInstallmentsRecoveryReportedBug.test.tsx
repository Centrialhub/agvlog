import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ReceivablePaymentInstallments } from '@/components/financial/ReceivablePaymentInstallments';

const mocks = vi.hoisted(() => ({ read: vi.fn(), Changed: class extends Error {} }));
vi.mock('@/lib/financial/receivablePaymentInstallments', () => ({
  readReceivablePaymentInstallments: mocks.read,
  ReceivablePaymentInstallmentsChangedError: mocks.Changed,
}));
const ids = { tenant: crypto.randomUUID(), actor: crypto.randomUUID(), receivable: crypto.randomUUID(), payment: crypto.randomUUID() };
const page = (offset = 0) => ({ version: 1, tenant_id: ids.tenant, actor_id: ids.actor, receivable_id: ids.receivable, payment_id: ids.payment, revision: 'a'.repeat(32), offset, limit: 30, total: 31, next_offset: offset === 0 ? 30 : null, rows: [] });
function mount() { return render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ReceivablePaymentInstallments {...ids} /></QueryClientProvider>); }
beforeEach(() => mocks.read.mockReset());
afterEach(cleanup);

it('oferece nova tentativa depois de uma falha temporária', async () => {
  mocks.read.mockRejectedValueOnce(new Error('offline')).mockResolvedValueOnce(page());
  mount(); expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível conferir');
  fireEvent.click(screen.getByRole('button', { name: 'Tentar consultar distribuições novamente' }));
  await screen.findByText('31 evento(s) de distribuição'); expect(mocks.read).toHaveBeenCalledTimes(2);
});

it('volta à primeira página quando a revisão muda', async () => {
  mocks.read.mockResolvedValueOnce(page()).mockRejectedValueOnce(new mocks.Changed()).mockResolvedValueOnce(page());
  mount(); await screen.findByText('31 evento(s) de distribuição');
  fireEvent.click(screen.getByRole('button', { name: 'Próximas distribuições' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('mudou enquanto você navegava');
  fireEvent.click(screen.getByRole('button', { name: 'Voltar à primeira página das distribuições' }));
  await waitFor(() => expect(screen.getByText('31 evento(s) de distribuição')).toBeInTheDocument());
});
