import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';

const state = vi.hoisted(() => ({
  docs: [{ id: 'note-a', recipient_city: 'SALINAS', pallet_count: 1, created_at: '2026-09-22' }],
  vehicles: [{ id: 'v1', plate: 'AAA', max_pallets: 2, current_driver_id: 'd1' }, { id: 'v2', plate: 'BBB', max_pallets: 3, current_driver_id: 'd2' }],
  drivers: [{ id: 'd1', name: 'Motorista 1' }, { id: 'd2', name: 'Motorista 2' }],
  routes: [{ id: 'route-a', name: 'Salinas', destinations: [{ name: 'SALINAS' }] }],
  submit: vi.fn(async () => ({})), recover: vi.fn(async () => ({ load: { load_number: '1031' }, document_count: 1 })),
  pending: [] as { scope: string }[], success: vi.fn(),
  tenantId: 'tenant', isPending: false, error: '',
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: state.tenantId } }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: state.vehicles }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: state.drivers }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: state.routes }) }));
vi.mock('@/hooks/useLoadCreation', () => ({ useLoadCreation: () => ({ submit: state.submit, recover: state.recover, pending: state.pending, error: state.error, isPending: state.isPending }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: state.success, error: vi.fn() }) }));
vi.mock('@/lib/supabase/fetchAllPages', () => ({ fetchAllPostgrestPages: async () => state.docs }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean }) =>
    <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { children: ReactNode; value: string }) => <option value={value}>{value === '__none__' ? 'Nenhum' : value}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); state.pending = []; });
beforeEach(() => {
  state.docs = [{ id: 'note-a', recipient_city: 'SALINAS', pallet_count: 1, created_at: '2026-09-22' }];
  state.routes = [{ id: 'route-a', name: 'Salinas', destinations: [{ name: 'SALINAS' }] }];
  state.tenantId = 'tenant'; state.isPending = false; state.error = '';
});
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  const view = (open: boolean) => <QueryClientProvider client={client}><PendingDocsGrouping open={open} onOpenChange={vi.fn()} onCreated={onCreated} /></QueryClientProvider>;
  const rendered = render(view(true));
  return { client, onCreated, reopen: (open = true) => rendered.rerender(view(open)) };
};

const prepareCities = (three = false) => {
  state.routes = [
    { id: 'jaiba', name: 'Jaíba', destinations: [{ name: 'JAÍBA' }] },
    { id: 'espinosa', name: 'Espinosa', destinations: [{ name: 'ESPINOSA' }] },
    { id: 'salinas', name: 'Salinas', destinations: [{ name: 'SALINAS' }] },
  ];
  state.docs = [
    { id: 'note-jaiba', recipient_city: 'JAÍBA', pallet_count: 1, created_at: '2026-09-22' },
    { id: 'note-espinosa', recipient_city: 'ESPINOSA', pallet_count: 1, created_at: '2026-09-22' },
    ...(three ? [{ id: 'note-salinas', recipient_city: 'SALINAS', pallet_count: 1, created_at: '2026-09-22' }] : []),
  ];
};
const join = (target: string, source: string) => {
  fireEvent.click(screen.getByRole('button', { name: `Juntar outro grupo a ${target}` }));
  fireEvent.click(screen.getByRole('button', { name: `Adicionar ${source}` }));
};
describe('grouped creation screen', () => {
  it('keeps explicit vehicle/driver selections after refreshed notes and sends the supported header', async () => {
    const { client } = mount();
    await screen.findByText('Criar 1 Carga(s)');
    const choices = screen.getAllByRole('combobox');
    fireEvent.change(choices[0], { target: { value: 'v2' } });
    fireEvent.change(choices[1], { target: { value: '__none__' } });
    await act(async () => { client.setQueryData(['pending_fiscal_docs', 'tenant'], state.docs.map(doc => ({ ...doc, value: 500 }))); });
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('v2');
    expect(screen.getAllByRole('combobox')[1]).toHaveValue('__none__');
    fireEvent.click(screen.getByText('Criar 1 Carga(s)'));
    await waitFor(() => expect(state.submit).toHaveBeenCalledWith('Salinas', {
      changes: { destination: 'Salinas', vehicle_id: 'v2', driver_id: null }, document_ids: ['note-a'],
    }));
  });

  it('offers recovery even if saved notes disappear from the pending list', async () => {
    state.pending = [{ scope: 'Salinas' }];
    const { client, onCreated } = mount();
    await screen.findByText('Recuperar criação');
    await act(async () => { client.setQueryData(['pending_fiscal_docs', 'tenant'], []); });
    fireEvent.click(screen.getByText('Recuperar criação'));
    await waitFor(() => expect(state.recover).toHaveBeenCalledWith('Salinas'));
    expect(state.success).toHaveBeenCalledWith('Carga 1031 confirmada (1 notas).');
    expect(onCreated).toHaveBeenCalled();
  });

  it('combines Jaíba and Espinosa before creation, preserving target assignments and sending each note once', async () => {
    prepareCities();
    const { client } = mount();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    const choices = screen.getAllByRole('combobox');
    fireEvent.change(choices[0], { target: { value: 'v2' } });
    fireEvent.change(choices[1], { target: { value: '__none__' } });
    await act(async () => { client.setQueryData(['pending_fiscal_docs', 'tenant'], state.docs.map((doc, index) => ({ ...doc, weight_kg: (index + 1) * 100, value: (index + 1) * 500 }))); });
    join('Jaíba', 'Espinosa');
    expect(state.submit).not.toHaveBeenCalled();
    expect(screen.getByText('Jaíba - Espinosa')).toBeInTheDocument();
    expect(screen.getByText('2 paletes')).toBeInTheDocument();
    expect(screen.getByText('300 kg')).toBeInTheDocument();
    expect(screen.getByText('R$ 1.500')).toBeInTheDocument();
    expect(screen.getAllByRole('combobox')).toHaveLength(2);
    expect(screen.getAllByRole('combobox')[0]).toHaveValue('v2');
    expect(screen.getAllByRole('combobox')[1]).toHaveValue('__none__');
    expect(screen.getByRole('button', { name: 'Juntar outro grupo a Jaíba - Espinosa' })).toBeDisabled();
    fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit).toHaveBeenCalledWith('Jaíba', {
      changes: { destination: 'Jaíba - Espinosa', vehicle_id: 'v2', driver_id: null },
      document_ids: ['note-jaiba', 'note-espinosa'],
    });
  });

  it('allows chaining and separating groups without writing a load', async () => {
    prepareCities(true);
    mount();
    await screen.findByRole('button', { name: 'Criar 3 Carga(s)' });
    join('Jaíba', 'Espinosa');
    join('Salinas', 'Jaíba - Espinosa');
    expect(screen.getByText('Salinas - Jaíba - Espinosa')).toBeInTheDocument();
    expect(screen.getByText('3 paletes')).toBeInTheDocument();
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    fireEvent.click(screen.getByRole('button', { name: 'Separar grupos de Salinas - Jaíba - Espinosa' }));
    expect(screen.getAllByRole('checkbox')).toHaveLength(3);
    expect(screen.getByRole('button', { name: 'Criar 3 Carga(s)' })).toBeInTheDocument();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('blocks creation when combined pallets exceed capacity and permits a larger vehicle', async () => {
    prepareCities();
    state.docs[0].pallet_count = 2;
    mount();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'v1' } });
    join('Jaíba', 'Espinosa');
    expect(screen.getByRole('alert')).toHaveTextContent('Excede a capacidade do veículo');
    const create = screen.getByRole('button', { name: 'Criar 1 Carga(s)' });
    expect(create).toBeDisabled();
    fireEvent.click(create);
    expect(state.submit).not.toHaveBeenCalled();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'v2' } });
    expect(create).toBeEnabled();
    fireEvent.click(create);
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit.mock.calls[0]).toEqual(['Jaíba', {
      changes: { destination: 'Jaíba - Espinosa', vehicle_id: 'v2', driver_id: 'd2' }, document_ids: ['note-jaiba', 'note-espinosa'],
    }]);
  });

  it('combines two already consolidated groups into one creation with unique document IDs', async () => {
    prepareCities(true);
    state.routes.push({ id: 'montes-claros', name: 'Montes Claros', destinations: [{ name: 'MONTES CLAROS' }] });
    state.docs.push({ id: 'note-montes', recipient_city: 'MONTES CLAROS', pallet_count: 1, created_at: '2026-09-22' });
    mount();
    await screen.findByRole('button', { name: 'Criar 4 Carga(s)' });
    join('Jaíba', 'Espinosa');
    join('Salinas', 'Montes Claros');
    join('Salinas - Montes Claros', 'Jaíba - Espinosa');
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: '__none__' } });
    expect(screen.getByText('4 paletes')).toBeInTheDocument();
    expect(state.submit).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit).toHaveBeenCalledWith('Salinas', {
      changes: { destination: 'Salinas - Montes Claros - Jaíba - Espinosa', vehicle_id: null, driver_id: null },
      document_ids: ['note-salinas', 'note-montes', 'note-jaiba', 'note-espinosa'],
    });
  });

  it('rebuilds a combined group from refreshed notes and excludes documents that are no longer pending', async () => {
    prepareCities();
    const { client } = mount();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    join('Jaíba', 'Espinosa');
    const remaining = [{ ...state.docs[1], pallet_count: 2 }];
    state.docs = remaining;
    await act(async () => { client.setQueryData(['pending_fiscal_docs', 'tenant'], remaining); });
    await screen.findByText('Espinosa');
    expect(screen.getByText('2 paletes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledWith('Jaíba', {
      changes: { destination: 'Espinosa', vehicle_id: 'v1', driver_id: 'd1' }, document_ids: ['note-espinosa'],
    }));
  });

  it('selects a combined target even when its constituent groups were unchecked', async () => {
    prepareCities();
    mount();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    screen.getAllByRole('checkbox').forEach(checkbox => fireEvent.click(checkbox));
    expect(screen.getByRole('button', { name: 'Criar 0 Carga(s)' })).toBeDisabled();
    join('Jaíba', 'Espinosa');
    expect(screen.getByRole('button', { name: 'Criar 1 Carga(s)' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Separar grupos de Jaíba - Espinosa' }));
    expect(screen.getByRole('button', { name: 'Criar 2 Carga(s)' })).toBeEnabled();
  });

  it('keeps one group if its main destination disappears, another group is added and the main notes return', async () => {
    prepareCities(true);
    const original = [...state.docs];
    const { client } = mount();
    await screen.findByRole('button', { name: 'Criar 3 Carga(s)' });
    join('Jaíba', 'Espinosa');
    state.docs = original.filter(doc => doc.id !== 'note-jaiba');
    await act(async () => { client.setQueryData(['pending_fiscal_docs', 'tenant'], state.docs); });
    await screen.findByRole('button', { name: 'Juntar outro grupo a Espinosa' });
    join('Espinosa', 'Salinas');
    state.docs = original;
    await act(async () => { client.setQueryData(['pending_fiscal_docs', 'tenant'], original); });
    await screen.findByText('3 paletes');
    expect(screen.getAllByRole('checkbox')).toHaveLength(1);
    expect(screen.getByText('Jaíba - Espinosa - Salinas')).toBeInTheDocument();
    fireEvent.change(screen.getAllByRole('combobox')[0], { target: { value: 'v2' } });
    await waitFor(() => expect(screen.getAllByRole('combobox')[1]).toHaveValue('d2'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit).toHaveBeenCalledWith('Jaíba', {
      changes: { destination: 'Jaíba - Espinosa - Salinas', vehicle_id: 'v2', driver_id: 'd2' },
      document_ids: ['note-jaiba', 'note-espinosa', 'note-salinas'],
    });
  });

  it.each(['pending', 'error', 'in-flight'] as const)('locks combining while creation is %s', async condition => {
    prepareCities();
    if (condition === 'pending') state.pending = [{ scope: 'Jaíba' }];
    if (condition === 'error') state.error = 'Falha no contexto';
    if (condition === 'in-flight') state.isPending = true;
    mount();
    const plus = await screen.findByRole('button', { name: 'Juntar outro grupo a Jaíba' });
    expect(plus).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Criar 2 Carga(s)' })).toBeDisabled();
  });

  it('discards the temporary combination when closing and reopening', async () => {
    prepareCities();
    const { reopen } = mount();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    join('Jaíba', 'Espinosa');
    reopen(false);
    reopen();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    expect(screen.queryByText('Jaíba - Espinosa')).not.toBeInTheDocument();
    expect(state.submit).not.toHaveBeenCalled();
  });

  it('does not carry combinations or assignments into a different tenant', async () => {
    prepareCities();
    const { reopen } = mount();
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    join('Jaíba', 'Espinosa');
    state.tenantId = 'tenant-b';
    state.docs = [{ id: 'tenant-b-note', recipient_city: 'SALINAS', pallet_count: 1, created_at: '2026-09-22' }];
    reopen();
    await screen.findByText('Salinas');
    expect(screen.queryByText('Jaíba - Espinosa')).not.toBeInTheDocument();
    await waitFor(() => expect(screen.getAllByRole('combobox')[1]).toHaveValue('d1'));
    fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledWith('Salinas', {
      changes: { destination: 'Salinas', vehicle_id: 'v1', driver_id: 'd1' }, document_ids: ['tenant-b-note'],
    }));
  });
});
