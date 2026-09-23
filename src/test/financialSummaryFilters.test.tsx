import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import Financial from '@/pages/Financial';

const mock = vi.hoisted(() => ({
  portfolio: vi.fn().mockResolvedValue({}),
  cost: vi.fn().mockResolvedValue({}),
  fiscal: vi.fn().mockResolvedValue({}),
  tenant: 'tenant',
}));

vi.mock('@/components/financial/UnbilledFreightPanel', () => ({ UnbilledFreightPanel: () => <p>Previsão com filtros próprios</p> }));
vi.mock('@/components/ui/searchable-select', () => ({
  SearchableSelect: ({ ariaLabel, value, onChange, options }: { ariaLabel: string; value: string; onChange: (value: string) => void; options: Array<{ value: string; label: string }> }) => (
    <select aria-label={ariaLabel} value={value} onChange={event => onChange(event.target.value)}>
      {options.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
    </select>
  ),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: mock.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('react-router-dom', () => ({
  useNavigate: () => vi.fn(),
  useSearchParams: () => [new URLSearchParams(), vi.fn()],
}));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [{ id: 'client', company_name: 'Cliente QA', active: true }] }) }));
vi.mock('@/hooks/useCostCenters', () => ({ useCostCenters: () => ({ fullData: [{ id: 'center-id', name: 'Centro QA', active: true }] }) }));
vi.mock('@/lib/financial/receivablePortfolioClient', () => ({ readReceivablePortfolio: mock.portfolio }));
vi.mock('@/lib/financial/recordedCostSummaryClient', () => ({ readRecordedCostSummary: mock.cost }));
vi.mock('@/lib/financial/fiscalDashboardClient', () => ({ readFiscalDashboard: mock.fiscal }));
vi.mock('@/components/financial/ReceivablePortfolio', () => ({ ReceivablePortfolioCard: () => null, ReceivablePortfolioStatus: () => null }));
vi.mock('@/components/financial/RecordedCostSummary', () => ({ RecordedCostCard: () => null, RecordedCostSummary: () => null }));
vi.mock('@/components/financial/FiscalDashboardSummary', () => ({ FiscalDashboardCard: () => null, FiscalDashboardSummary: () => null }));

beforeEach(() => {
  mock.tenant = 'tenant';
  vi.stubGlobal('ResizeObserver', class {
    observe() {}
    unobserve() {}
    disconnect() {}
  });
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  vi.unstubAllGlobals();
});

it('applies the proper filters to each server summary only after explicit apply, keeping forecast filters independent', async () => {
  render(<QueryClientProvider client={new QueryClient()}><Financial /></QueryClientProvider>);
  await waitFor(() => expect(mock.portfolio).toHaveBeenCalledTimes(1));

  fireEvent.change(screen.getByLabelText('Data inicial'), { target: { value: '2026-01-01' } });
  fireEvent.change(screen.getByLabelText('Data final'), { target: { value: '2026-01-31' } });
  fireEvent.change(screen.getByRole('combobox', { name: 'Cliente — carteira e fiscal' }), { target: { value: 'client' } });
  fireEvent.change(screen.getByLabelText('Tipo fiscal'), { target: { value: 'nfse' } });
  fireEvent.change(screen.getByLabelText('Categoria dos custos registrados'), { target: { value: 'payroll' } });
  fireEvent.change(screen.getByLabelText('Centro de custo dos registros incorporados'), { target: { value: 'center-id' } });

  expect(mock.portfolio).toHaveBeenCalledTimes(1);
  await waitFor(() => expect(screen.getByRole('button', { name: 'Aplicar filtros' })).toBeEnabled());
  fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));

  await waitFor(() => expect(mock.fiscal).toHaveBeenLastCalledWith('tenant', {
    from: '2026-01-01',
    to: '2026-01-31',
    client: 'client',
    docType: 'nfse',
  }));
  expect(mock.cost).toHaveBeenLastCalledWith('tenant', {
    from: '2026-01-01',
    to: '2026-01-31',
    category: 'payroll',
    costCenter: 'center-id',
  });
  expect(mock.portfolio).toHaveBeenLastCalledWith('tenant', {
    from: '2026-01-01',
    to: '2026-01-31',
    client: 'client',
  });
  fireEvent.click(screen.getByText('Fretes a faturar'));
  expect(await screen.findByText(/Previsão com filtros próprios/)).toBeInTheDocument();
});

it('descarta cliente e centro de custo da empresa anterior ao trocar de tenant', async () => {
  const view=render(<QueryClientProvider client={new QueryClient()}><Financial /></QueryClientProvider>);
  fireEvent.change(screen.getByRole('combobox',{name:'Cliente — carteira e fiscal'}),{target:{value:'client'}});
  fireEvent.change(screen.getByLabelText('Centro de custo dos registros incorporados'),{target:{value:'center-id'}});
  expect(screen.getByRole('combobox',{name:'Cliente — carteira e fiscal'})).toHaveValue('client');
  expect(screen.getByLabelText('Centro de custo dos registros incorporados')).toHaveValue('center-id');
  mock.tenant='tenant-b';
  view.rerender(<QueryClientProvider client={new QueryClient()}><Financial /></QueryClientProvider>);
  expect(screen.getByRole('combobox',{name:'Cliente — carteira e fiscal'})).toHaveValue('all');
  expect(screen.getByLabelText('Centro de custo dos registros incorporados')).toHaveValue('all');
});
