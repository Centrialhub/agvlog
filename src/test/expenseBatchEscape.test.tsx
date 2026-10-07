import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import { ExpenseBatchDialog } from '@/components/financial/ExpenseBatchDialog';

vi.mock('@/lib/financial/ledgerClient', () => ({
  recordExpenseBatch: vi.fn(),
  FinanceRejectedError: class extends Error {},
  readExpenseOptions: vi.fn(async () => ({ total: 0, rows: [] })),
}));
afterEach(() => { cleanup(); sessionStorage.clear(); });

it('Escape closes a nested option picker while preserving the expense dialog and draft', async () => {
  const tenant = crypto.randomUUID(), actor = crypto.randomUUID(), onClose = vi.fn();
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
    <ExpenseBatchDialog tenant={tenant} actor={actor} onClose={onClose} onRecorded={vi.fn()} />
  </QueryClientProvider>);
  fireEvent.change(screen.getByLabelText('Descrição 1'), { target: { value: 'Rascunho preservado' } });
  const trigger = screen.getByRole('button', { name: 'Viagem finalizada: Selecionar' });
  fireEvent.click(trigger);
  const search = screen.getByLabelText('Buscar Viagem finalizada');
  await waitFor(() => expect(search).toHaveFocus());
  fireEvent.keyDown(search, { key: 'Escape', bubbles: true });
  await waitFor(() => expect(screen.queryByRole('group', { name: 'Selecionar Viagem finalizada' })).not.toBeInTheDocument());
  expect(onClose).not.toHaveBeenCalled();
  expect(screen.getByRole('dialog', { name: 'Conferir gastos em lote' })).toBeVisible();
  expect(screen.getByLabelText('Descrição 1')).toHaveValue('Rascunho preservado');
  expect(trigger).toHaveFocus();
  expect(JSON.parse(sessionStorage.getItem(`finance-expense-batch:${tenant}:${actor}`)!).draft.lines[0].description).toBe('Rascunho preservado');
  fireEvent.keyDown(screen.getByLabelText('Descrição 1'), { key: 'Escape', bubbles: true });
  expect(onClose).toHaveBeenCalledOnce();
});
