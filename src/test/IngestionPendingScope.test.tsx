import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Ingestion from '@/pages/Ingestion';
type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[], isError: false, isFetching: false, refetch: vi.fn() }));
vi.mock('@/hooks/useFiscalDocuments', () => ({ useFiscalDocuments: () => ({ data: state.rows, isError: state.isError, isFetching: state.isFetching, refetch: state.refetch }), useCreateFiscalDocument: () => ({}) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/hooks/useOrders', () => ({ useCreateOrder: () => ({}) }));
vi.mock('@/hooks/useLoads', () => ({ useCreateLoad: () => ({}), useLoads: () => ({ data: [] }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [] }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: [] }), useUpdateOperationalRoute: () => ({}) }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor' } }) }));
vi.mock('@/hooks/useItemPreparationWrites', () => ({ useItemPreparationWrites: () => ({}) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/hooks/useFreightCalculator', () => ({ calculateFreight: vi.fn(), logFreightCalculation: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/components/loads/PendingDocsGrouping', () => ({ default: ({ open }: { open: boolean }) => open ? <div role="dialog">Agrupamento aberto</div> : null }));
vi.mock('@/components/pickup/PickupOrderPicker', () => ({ default: () => null }));
vi.mock('@/components/ingestion/ORTReviewStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/RoutingStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/GroupingStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/ResultsStep', () => ({ default: () => null }));
vi.mock('@/components/ingestion/UploadStep', () => ({ default: () => <div>Upload</div> }));
vi.mock('@/components/ingestion/ValidationStep', () => ({ default: () => null }));
let client: QueryClient;
const note = (id: string, extra: Row = {}): Row => ({ id, invoice_number: id, document_type: 'inbound', status: 'confirmed', load_id: null, deleted_at: null, current_delivery_attempt_id: null, ...extra });
beforeEach(() => { state.rows = []; state.isError = false; state.isFetching = false; state.refetch.mockReset();
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });
function content() { return <QueryClientProvider client={client}><MemoryRouter><Ingestion /></MemoryRouter></QueryClientProvider>; }
describe('CT-PROD-AUD-INGESTION-SCOPE: count/list/promise for the grouping eligible set', () => {
  it('shows only the confirmed inbound free document from the reviewed five-record counterexample', () => {
    state.rows = [note('eligible'), note('outbound', { document_type: 'outbound' }), note('pending', { status: 'pending' }), note('cancelled', { status: 'cancelled' }), note('linked', { load_id: 'load' })];
    render(content()); expect(screen.getByText('1 NF-e(s) disponíveis para agrupamento')).toBeVisible(); expect(screen.getByText('NF eligible')).toBeVisible();
    for (const id of ['outbound', 'pending', 'cancelled', 'linked']) expect(screen.queryByText('NF ' + id)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Retomar agrupamento' })); expect(screen.getByRole('dialog')).toHaveTextContent('Agrupamento aberto');
  });
  it('excludes previous issued attempts/deletion but preserves issuance without a previous attempt', () => {
    state.rows = [note('first-issued', { cte_emitted_at: '2026-10-05T12:00:00Z' }), note('previous', { current_delivery_attempt_id: 'attempt', cte_emitted_at: '2026-10-05T12:00:00Z' }), note('deleted', { deleted_at: '2026-10-05T12:00:00Z' }), note('transfer', { document_type: 'transfer' })];
    render(content()); expect(screen.getByText('1 NF-e(s) disponíveis para agrupamento')).toBeVisible(); expect(screen.getByText('NF first-issued')).toBeVisible();
    expect(screen.queryByText('NF previous')).not.toBeInTheDocument(); expect(screen.queryByText('NF deleted')).not.toBeInTheDocument(); expect(screen.queryByText('NF transfer')).not.toBeInTheDocument();
  });
  it('distinguishes unavailable read from empty result and hides stale count/list/promise', () => {
    state.rows = [note('stale')]; state.isError = true; render(content());
    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível atualizar as NF-es'); expect(screen.queryByText('NF stale')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retomar agrupamento' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar NF-es' })); expect(state.refetch).toHaveBeenCalledOnce();
  });
  it('blocks opening during refresh and restores the eligible action on successful refresh', () => {
    state.rows = [note('eligible')]; state.isFetching = true; const view = render(content()); expect(screen.getByRole('button', { name: 'Retomar agrupamento' })).toBeDisabled();
    state.isFetching = false; view.rerender(content()); expect(screen.getByRole('button', { name: 'Retomar agrupamento' })).toBeEnabled();
  });
  it('renders no grouping promise for a successful empty eligible set', () => {
    state.rows = [note('outbound', { document_type: 'outbound' })]; render(content()); expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Retomar agrupamento' })).not.toBeInTheDocument();
  });
});
