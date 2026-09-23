import { afterEach, describe, expect, it, vi } from 'vitest';
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
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: state.vehicles }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: state.drivers }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: state.routes }) }));
vi.mock('@/hooks/useLoadCreation', () => ({ useLoadCreation: () => ({ submit: state.submit, recover: state.recover, pending: state.pending, error: '', isPending: false }) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: state.success, error: vi.fn() }) }));
vi.mock('@/lib/supabase/fetchAllPages', () => ({ fetchAllPostgrestPages: async () => state.docs }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: { children: ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean }) =>
    <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { children: ReactNode; value: string }) => <option value={value}>{value === '__none__' ? 'Nenhum' : value}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));
afterEach(() => { cleanup(); vi.clearAllMocks(); state.pending = []; });
const mount = () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onCreated = vi.fn();
  render(<QueryClientProvider client={client}><PendingDocsGrouping open onOpenChange={vi.fn()} onCreated={onCreated} /></QueryClientProvider>);
  return { client, onCreated };
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
});
