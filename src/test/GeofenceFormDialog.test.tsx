import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { GeofenceFormDialog, type EditableFleetGeofence } from '@/components/geofences/GeofenceFormDialog';

const mock = vi.hoisted(() => ({ rpc: vi.fn(), success: vi.fn(), error: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));
vi.mock('@/hooks/useSonnerToast', () => ({
  useSonnerToast: () => ({ success: mock.success, error: mock.error }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor-a' } }) }));
vi.mock('@/components/maps/LocationPicker', () => ({
  LocationPicker: ({ address, value, onAddressChange, onChange }: {
    address: string;
    value: { latitude: number; longitude: number } | null;
    onAddressChange: (value: string) => void;
    onChange: (value: unknown) => void;
  }) => <div>
    <label htmlFor="mock-address">Endereço</label>
    <input id="mock-address" value={address} onChange={(event) => onAddressChange(event.target.value)} />
    <button type="button" onClick={() => onChange({ latitude: -23.551, longitude: -46.634,
      source: 'map_selected', address: address || null, provider: 'leaflet_map', accuracy_m: null,
      confidence: 1, audit: { selected_interactively: true } })}>Arrastar marcador</button>
    <output>{value ? `${value.latitude},${value.longitude}` : 'sem ponto'}</output>
  </div>,
}));

const fleetGeofence: EditableFleetGeofence = {
  id: '84000000-0000-4000-8000-000000000001', name: 'Garagem SP', category: 'base', enabled: true,
  shape_kind: 'circle', scope_kind: 'fleet', dispatch_stop_id: null, source_kind: 'address_geocoded',
  source_address: 'Rua A, 10, São Paulo - SP', center_lat: -23.55, center_lng: -46.63, radius_m: 250,
  location_provider: 'nominatim', location_accuracy_m: 30, location_confidence: 0.9,
  location_audit: { selected_label: 'Rua A' }, enter_margin_m: 0, exit_margin_m: 30,
  transition_confirmations: 2,
};

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  mock.rpc.mockImplementation((_name, args) => Promise.resolve({
    data: { ok: true, request_id: args._payload.request_id, geofence_id: fleetGeofence.id }, error: null,
  }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup();client.clear(); });

function renderDialog(geofence: EditableFleetGeofence = fleetGeofence) {
  return render(<QueryClientProvider client={client}>
    <GeofenceFormDialog open onOpenChange={vi.fn()} tenantId="tenant-a" geofence={geofence} />
  </QueryClientProvider>);
}

describe('fleet geofence editor', () => {
  it('edits the point, radius and hysteresis through the canonical RPC', async () => {
    renderDialog();
    expect(screen.getByRole('heading', { name: 'Editar Cerca de Frota' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Arrastar marcador' }));
    fireEvent.change(screen.getByLabelText('Raio (metros)'), { target: { value: '450' } });
    fireEvent.change(screen.getByLabelText('Histerese de saída (m)'), { target: { value: '75' } });
    fireEvent.change(screen.getByLabelText('Margem de entrada (m)'), { target: { value: '10' } });
    fireEvent.change(screen.getByLabelText('Posições para confirmar'), { target: { value: '3' } });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));

    await waitFor(() => expect(mock.rpc).toHaveBeenCalledOnce());
    expect(mock.rpc).toHaveBeenCalledWith('upsert_geofence_v4', { _payload: expect.objectContaining({
      id: fleetGeofence.id, tenant_id: 'tenant-a', scope_kind: 'fleet', source_kind: 'map_selected',
      center_lat: -23.551, center_lng: -46.634, radius_m: 450, enter_margin_m: 10,
      exit_margin_m: 75, transition_confirmations: 3, request_id: expect.any(String),
    }) });
  });

  it('requires reconfirming the point after the address is changed', () => {
    renderDialog();
    fireEvent.change(screen.getByLabelText('Endereço'), { target: { value: 'Avenida Nova, 500' } });
    expect(screen.getByText('sem ponto')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.error).toHaveBeenCalledWith('Pesquise o endereço ou marque o ponto no mapa.');
  });

  it('reuses request_id when the same submission is retried after an uncertain failure', async () => {
    mock.rpc.mockResolvedValueOnce({ data: null, error: { message: 'network_lost' } })
      .mockImplementationOnce((_name, args) => Promise.resolve({
        data: { ok: true, request_id: args._payload.request_id, geofence_id: fleetGeofence.id }, error: null,
      }));
    const firstView = renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(1));
    expect(localStorage.length).toBe(1);
    firstView.unmount();
    renderDialog();
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    await waitFor(() => expect(mock.rpc).toHaveBeenCalledTimes(2));
    const first = mock.rpc.mock.calls[0][1]._payload.request_id;
    const second = mock.rpc.mock.calls[1][1]._payload.request_id;
    expect(second).toBe(first);
    expect(localStorage.length).toBe(0);
  });

  it('refuses a delivery geofence even if the editor is invoked programmatically', () => {
    renderDialog({ ...fleetGeofence, scope_kind: 'delivery', dispatch_stop_id: 'stop-a' });
    fireEvent.click(screen.getByRole('button', { name: 'Salvar alterações' }));
    expect(mock.rpc).not.toHaveBeenCalled();
    expect(mock.error).toHaveBeenCalledWith('Cercas automáticas de entrega só podem ser alteradas pelo destino da parada.');
  });
});
