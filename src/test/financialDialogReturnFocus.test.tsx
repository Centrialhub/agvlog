import { useState } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { ExpenseBatchDialog } from '@/components/financial/ExpenseBatchDialog';
import { ManualExpenseWorkspace } from '@/components/financial/ManualExpenseWorkspace';

const api = vi.hoisted(() => ({ batch: vi.fn(), manual: vi.fn(), upload: vi.fn(), remove: vi.fn() }));
vi.mock('@/lib/financial/ledgerClient', () => ({
  recordExpenseBatch: api.batch, recordManualExpense: api.manual, FinanceRejectedError: class extends Error {},
  readExpenseOptions: vi.fn(async () => ({ total: 0, rows: [] })),
  readManualExpenseMovements: vi.fn(async () => ({ total: 0, rows: [] })),
}));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [], error: null }) }));
vi.mock('@/hooks/useCostCenters', () => ({ useCostCenters: () => ({ data: [], fullData: [] }) }));
vi.mock('@/hooks/usePayables', () => ({ PAYABLE_CATEGORIES: ['other'], PAYABLE_CATEGORY_LABELS: { other: 'Outro' } }));
vi.mock('@/hooks/useFinancialPayments', () => ({ PAYMENT_METHODS: ['pix'], PAYMENT_METHOD_LABELS: { pix: 'PIX' }, uploadPaymentAttachment: api.upload }));
vi.mock('@/lib/secureUpload', () => ({ removeSecureFiles: api.remove }));

const tenant = '10000000-0000-4000-8000-000000000001';
const actor = '20000000-0000-4000-8000-000000000001';
beforeEach(() => { vi.clearAllMocks(); sessionStorage.clear(); api.remove.mockResolvedValue(undefined); });
afterEach(cleanup);

function Host({ kind }: { kind: 'batch' | 'manual' }) {
  const [open, setOpen] = useState(false);
  return <>
    <button>Outro botão</button>
    <button onClick={() => setOpen(true)}>{kind === 'batch' ? 'Conferir gastos em lote' : 'Adicionar despesa'}</button>
    {open && (kind === 'batch'
      ? <ExpenseBatchDialog tenant={tenant} actor={actor} onClose={() => setOpen(false)} onRecorded={api.batch} />
      : <ManualExpenseWorkspace tenant={tenant} actor={actor} onClose={() => setOpen(false)} />)}
  </>;
}
function mount(kind: 'batch' | 'manual') {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<QueryClientProvider client={client}><Host kind={kind} /></QueryClientProvider>);
  const trigger = screen.getByRole('button', { name: kind === 'batch' ? 'Conferir gastos em lote' : 'Adicionar despesa' });
  // Model a keyboard/click opener with real DOM focus; fireEvent.click alone
  // does not implement the browser's native click-to-focus behavior.
  trigger.focus(); fireEvent.click(trigger); return trigger;
}
function expectNoFinancialWrites() {
  expect(api.batch).not.toHaveBeenCalled(); expect(api.manual).not.toHaveBeenCalled();
  expect(api.upload).not.toHaveBeenCalled(); expect(api.remove).not.toHaveBeenCalled();
}

it('Escape returns from batch input to the original opener and preserves the complete draft identity', async () => {
  const trigger = mount('batch');
  const input = screen.getByLabelText('Descrição do lote');
  fireEvent.change(input, { target: { value: 'Rascunho preservado sem registro' } });
  input.focus(); await waitFor(() => expect(input).toHaveFocus());
  const key = `finance-expense-batch:${tenant}:${actor}`;
  await waitFor(() => expect(sessionStorage.getItem(key)).not.toBeNull());
  const before = sessionStorage.getItem(key);
  const saved = JSON.parse(before!);
  expect(saved.batchRequest).toEqual(expect.any(String)); expect(saved.request).toBeNull();
  fireEvent.keyDown(input, { key: 'Escape', bubbles: true });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Conferir gastos em lote' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(sessionStorage.getItem(key)).toBe(before); expectNoFinancialWrites();
});

it('Escape returns from an empty manual form to its original opener without financial writes', async () => {
  const trigger = mount('manual'); const input = screen.getByLabelText('Descrição');
  input.focus(); await waitFor(() => expect(input).toHaveFocus());
  fireEvent.keyDown(input, { key: 'Escape', bubbles: true });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nova despesa avulsa' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(sessionStorage.getItem(`finance-manual-expense:${tenant}:${actor}`)).toBeNull();
  expectNoFinancialWrites();
});

it('closing manual recovery keeps the exact pending command and returns focus without resubmitting', async () => {
  const key = `finance-manual-expense:${tenant}:${actor}`;
  const pending = JSON.stringify({ actor, choice: null, command: {
    version: 1, tenant_id: tenant, request_id: '30000000-0000-4000-8000-000000000001',
    supplier_name: 'Fornecedor QA', description: 'Despesa preservada', category: 'other',
    amount_cents: 30000, reason: 'Registro já iniciado',
  } });
  sessionStorage.setItem(key, pending); const trigger = mount('manual');
  const retry = screen.getByRole('button', { name: 'Retomar mesma despesa' });
  retry.focus(); fireEvent.keyDown(retry, { key: 'Escape', bubbles: true });
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Nova despesa avulsa' })).not.toBeInTheDocument());
  await waitFor(() => expect(trigger).toHaveFocus());
  expect(sessionStorage.getItem(key)).toBe(pending); expectNoFinancialWrites();
});
