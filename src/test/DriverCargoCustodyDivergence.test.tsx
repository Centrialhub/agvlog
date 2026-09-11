import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DriverCargoCustody from '@/pages/driver/DriverCargoCustody';

const ids = {
  tenant: '71000000-0000-4000-8000-000000000001',
  actor: '71000000-0000-4000-8000-000000000002',
  driver: '71000000-0000-4000-8000-000000000003',
  trip: '71000000-0000-4000-8000-000000000004',
  vehicle: '71000000-0000-4000-8000-000000000005',
  control: '71000000-0000-4000-8000-000000000006',
  load1: '71000000-0000-4000-8000-000000000007',
  load2: '71000000-0000-4000-8000-000000000008',
  loadCheck1: '71000000-0000-4000-8000-000000000009',
  loadCheck2: '71000000-0000-4000-8000-000000000010',
  document1: '71000000-0000-4000-8000-000000000011',
  document2: '71000000-0000-4000-8000-000000000012',
};

const mocks = vi.hoisted(() => ({
  getCargo: vi.fn(),
  updateCargo: vi.fn(),
  upload: vi.fn(),
  put: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({ data: { id: ids.driver, name: 'Motorista QA' }, isPending: false }),
  useActiveTrip: () => ({ data: {
    id: ids.trip, status: 'loading', vehicle_id: ids.vehicle, actual_start_at: null, actual_end_at: null,
    vehicles: { plate: 'ABC1D23', nickname: null }, loads: null,
  }, isPending: false }),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: ids.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: ids.actor } }) }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => true }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
vi.mock('@/lib/secureUpload', () => ({ uploadSecureFile: mocks.upload }));
vi.mock('@/lib/driver/driverOperationalOffline', () => ({ driverOperationalSnapshotStore: {
  read: vi.fn().mockResolvedValue(null), put: mocks.put,
} }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: vi.fn() } }));
vi.mock('@/lib/driver/tripCargoCustody', async importOriginal => {
  const actual = await importOriginal<typeof import('@/lib/driver/tripCargoCustody')>();
  return { ...actual, getTripCargoControl: mocks.getCargo, updateDriverTripCargo: mocks.updateCargo };
});

const load = (id: string, loadId: string) => ({
  id, load_id: loadId, expected_volume_count: 10, expected_pallet_count: 2, expected_weight_kg: 100,
  confirmed_volume_count: null, confirmed_pallet_count: null, confirmed_weight_kg: null, confirmed_at: null,
});

const snapshot = {
  version: 1 as const,
  available: true as const,
  trip_id: ids.trip,
  trip_status: 'loading',
  control: {
    id: ids.control, tenant_id: ids.tenant, dispatch_trip_id: ids.trip, driver_id: ids.driver,
    vehicle_id: ids.vehicle, status: 'loading' as const, vehicle_checked: false, tie_down_confirmed: false,
    seal_not_applicable_reason: null, updated_at: '2026-09-10T12:00:00Z',
  },
  loads: [load(ids.loadCheck1, ids.load1), load(ids.loadCheck2, ids.load2)],
  documents: [{
    id: ids.document1, load_id: ids.load1, source_kind: 'nfe' as const,
    reference_number: 'NFE-101', driver_confirmed: true,
  }, {
    id: ids.document2, load_id: ids.load2, source_kind: 'nfse' as const,
    reference_number: 'NFSE-202', driver_confirmed: true,
  }],
  seals: [], evidence: [], divergences: [],
  physical_receipts: { required_count: 0, pending_count: 0, missing_count: 0 },
};

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.getCargo.mockResolvedValue(snapshot);
  mocks.updateCargo.mockResolvedValue({
    version: 1, confirmed: true, trip_id: ids.trip, control_id: ids.control, status: 'loading',
  });
  mocks.upload
    .mockResolvedValueOnce(`${ids.tenant}/trip-cargo/${ids.trip}/loading.jpg`)
    .mockResolvedValueOnce(`${ids.tenant}/trip-cargo/${ids.trip}/tie-down.jpg`);
  mocks.put.mockResolvedValue(undefined);
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); });

function show() {
  return render(<QueryClientProvider client={client}>
    <MemoryRouter initialEntries={[`/driver/cargo?trip=${ids.trip}`]}><DriverCargoCustody /></MemoryRouter>
  </QueryClientProvider>);
}

describe('driver cargo divergence targeting', () => {
  it('lets the driver select an affected load and document and sends both canonical ids', async () => {
    show();
    await screen.findByText('NFE-101', { exact: false });

    fireEvent.click(screen.getByText('Veículo conferido').closest('label')!);
    fireEvent.click(screen.getByText('Carga amarrada e estabilizada').closest('label')!);
    fireEvent.change(screen.getByLabelText('Motivo sem lacre'), { target: { value: 'Veículo sem ponto de lacre' } });
    fireEvent.change(screen.getByLabelText('Foto da carga'), { target: { files: [new File(['carga'], 'carga.jpg', { type: 'image/jpeg' })] } });
    fireEvent.change(screen.getByLabelText('Foto da amarração'), { target: { files: [new File(['amarração'], 'amarracao.jpg', { type: 'image/jpeg' })] } });
    fireEvent.change(screen.getByLabelText('Tipo de divergência'), { target: { value: 'document' } });

    expect(screen.getByLabelText('Carga afetada')).toBeInTheDocument();
    expect(screen.getByLabelText('Documento afetado')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Documento afetado'), { target: { value: ids.document2 } });
    expect(screen.getByLabelText('Carga afetada')).toHaveValue(ids.load2);
    fireEvent.change(screen.getByPlaceholderText('Descreva o que foi encontrado'), {
      target: { value: 'NFS-e impressa não corresponde à carga conferida' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Confirmar conferência da carga' }));
    await waitFor(() => expect(mocks.updateCargo).toHaveBeenCalledTimes(1));
    expect(mocks.updateCargo.mock.calls[0][0]).toMatchObject({
      action: 'confirm_cargo',
      payload: { divergences: [{
        kind: 'document',
        load_id: ids.load2,
        document_check_id: ids.document2,
        observed_value: ids.document2,
      }] },
    });
  });
});
