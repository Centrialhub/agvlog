import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import BankReconciliation from '@/pages/BankReconciliation';

const mocks = vi.hoisted(() => ({
  role: 'operator',
  access: true,
  accounts: vi.fn(),
  summary: vi.fn(),
  transactions: vi.fn(),
  obligations: vi.fn(),
  retryAccounts: vi.fn(),
  retrySummary: vi.fn(),
  retryTransactions: vi.fn(),
  retryObligations: vi.fn(),
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' }, currentRole: mocks.role }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useFinanceLedger', () => ({ useFinanceAccess: () => ({ data: mocks.access, isPending: false, error: null }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/pages/FinanceStatements', () => ({ default: () => <p>Área de extratos preservados</p> }));
vi.mock('@/components/financial/ReconciliationMovementEntry', () => ({ ReconciliationMovementEntry: () => null }));
vi.mock('@/components/financial/ReconciliationStatementImport', () => ({ ReconciliationStatementImport: () => null }));
vi.mock('@/hooks/useBankReconciliation', () => ({
  useBankAccounts: mocks.accounts,
  useCreateBankAccount: () => ({ mutate: vi.fn(), isPending: false }),
  useLegacyReconciliationSummary: mocks.summary,
  useBankTransactions: mocks.transactions,
  useFinancialObligations: mocks.obligations,
}));

beforeEach(() => {
  vi.clearAllMocks();
  mocks.role = 'operator';
  mocks.access = true;
  mocks.accounts.mockReturnValue({
    data: [{ id: 'account', name: 'Principal' }],
    isPending: false,
    isError: false,
    error: null,
    refetch: mocks.retryAccounts,
  });
  mocks.summary.mockReturnValue({
    data: {
      transaction_count: 1,
      inflow_cents: '0',
      outflow_cents: '50000',
      matched_count: 1,
      pending_count: 0,
      suggestion_count: 0,
      unmatched_transaction_count: 0,
      obligation_count: 0,
      unmatched_obligation_count: 0,
      driver_settlement_count: 0,
      driver_expense_count: 0,
      driver_pending_cents: '0',
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: mocks.retrySummary,
  });
  mocks.transactions.mockReturnValue({
    data: {
      rows: [{
        id: 'debit',
        posted_at: '2026-09-01T12:00:00Z',
        description: 'Débito registrado positivo',
        amount: 500,
        transaction_type: 'debit',
        reconciliation_status: 'matched',
        suggestions: [],
      }],
      has_more: false,
      next_cursor: null,
    },
    isPending: false,
    isError: false,
    error: null,
    refetch: mocks.retryTransactions,
  });
  mocks.obligations.mockReturnValue({ data: { rows: [], has_more: false, next_cursor: null }, isPending: false, isError: false, error: null, refetch: mocks.retryObligations });
});

afterEach(cleanup);

const mount = () => render(<MemoryRouter><BankReconciliation /></MemoryRouter>);
const openLegacy = () => fireEvent.mouseDown(screen.getByRole('tab', { name: 'Histórico anterior' }), { button: 0, ctrlKey: false });

it('opens the preserved statements workspace and loads legacy records only on request', () => {
  mount();
  expect(screen.getByText('Área de extratos preservados')).toBeInTheDocument();
  expect(mocks.transactions).not.toHaveBeenCalled();

  openLegacy();

  expect(mocks.transactions).toHaveBeenCalled();
  expect(screen.getByText(/Os status antigos não certificam/)).toBeInTheDocument();
  expect(screen.getByText(/Totais exatos para a conta/)).toBeInTheDocument();
  expect(screen.getByText('Saída · R$ 500,00')).toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Rodar conciliação' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Sincronizar títulos' })).not.toBeInTheDocument();
  expect(screen.queryByRole('button', { name: 'Conciliar' })).not.toBeInTheDocument();
});

it('shows loading and errors instead of misleading zero totals', () => {
  mocks.accounts.mockReturnValue({ data: undefined, isPending: true, isError: false, error: null, refetch: mocks.retryAccounts });
  const view = mount();
  openLegacy();
  expect(screen.getByRole('status')).toHaveTextContent('Carregando contas bancárias');
  expect(screen.queryByText('Entradas listadas')).not.toBeInTheDocument();

  view.unmount();
  mocks.accounts.mockReturnValue({
    data: [{ id: 'account', name: 'Principal' }],
    isPending: false,
    isError: false,
    error: null,
    refetch: mocks.retryAccounts,
  });
  mocks.transactions.mockReturnValue({
    data: undefined,
    isPending: false,
    isError: true,
    error: new Error('Falha de consulta'),
    refetch: mocks.retryTransactions,
  });
  mount();
  openLegacy();
  expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível carregar as transações');
  expect(screen.queryByText('Entradas listadas')).not.toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
  expect(mocks.retryTransactions).toHaveBeenCalledTimes(1);
});

it('uses the returned compound cursor when advancing and the cursor stack when going back', () => {
  const nextCursor = { posted_at: '2026-09-01T12:00:00Z', id: '00000000-0000-4000-8000-000000000001' };
  mocks.transactions.mockImplementation((_account, _start, _end, filters) => ({
    data: { rows: [], has_more: filters.cursor === null, next_cursor: filters.cursor === null ? nextCursor : null },
    isPending: false,
    isError: false,
    error: null,
    refetch: mocks.retryTransactions,
  }));
  mount();
  openLegacy();
  fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
  expect(mocks.transactions).toHaveBeenLastCalledWith('account', expect.any(String), expect.any(String), expect.objectContaining({ cursor: nextCursor }));
  fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
  expect(mocks.transactions).toHaveBeenLastCalledWith('account', expect.any(String), expect.any(String), expect.objectContaining({ cursor: null }));
});

it('distinguishes the confirmed absence of accounts from a query failure', () => {
  mocks.accounts.mockReturnValue({ data: [], isPending: false, isError: false, error: null, refetch: mocks.retryAccounts });
  mount();
  openLegacy();
  expect(screen.getByRole('status')).toHaveTextContent('Nenhuma conta bancária cadastrada');
  expect(screen.queryByText('Entradas listadas')).not.toBeInTheDocument();
});

it('validates inverted and overlong legacy periods before enabling the summary query', () => {
  mount();openLegacy();
  fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2026-01-02' } });
  expect(screen.getByRole('alert')).toHaveTextContent('data inicial não pode ser posterior');
  expect(mocks.summary).toHaveBeenLastCalledWith(null, '2026-01-02', '2026-01-01');
  fireEvent.change(screen.getByLabelText('Início'), { target: { value: '2000-01-01' } });
  fireEvent.change(screen.getByLabelText('Fim'), { target: { value: '2020-01-01' } });
  expect(screen.getByRole('alert')).toHaveTextContent('não pode ultrapassar 3.660 dias');
  expect(mocks.summary).toHaveBeenLastCalledWith(null, '2000-01-01', '2020-01-01');
});

it('denies drivers and internal users denied by the server before loading either workspace', () => {
  mocks.role = 'driver';
  const view = mount();
  expect(screen.getByRole('alert')).toHaveTextContent('Acesso financeiro não permitido');
  view.unmount();

  mocks.role = 'admin';
  mocks.access = false;
  mount();
  expect(screen.queryByText('Área de extratos preservados')).not.toBeInTheDocument();
  expect(mocks.transactions).not.toHaveBeenCalled();
});
