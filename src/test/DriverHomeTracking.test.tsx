import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import DriverHome from '@/pages/driver/DriverHome';

const mock = vi.hoisted(() => ({
  tenantId: '10000000-0000-4000-8000-000000000001',
  driverId: '20000000-0000-4000-8000-000000000001',
  tripId: '30000000-0000-4000-8000-000000000001',
  vehicleId: '40000000-0000-4000-8000-000000000001',
  positionShouldFail: true,
  positionCalls: 0,
  positionRpcArgs: [] as Array<{ _tenant_id: string; _vehicle_id: string }>,
}));

const trip = {
  id: mock.tripId,
  status: 'in_transit',
  actual_start_at: '2026-09-01T10:00:00.000Z',
  load_id: '50000000-0000-4000-8000-000000000001',
  vehicle_id: mock.vehicleId,
  vehicles: { plate: 'ABC1D23', nickname: 'QA' },
  loads: {
    id: '50000000-0000-4000-8000-000000000001',
    load_number: '1012',
    status: 'in_transit',
    origin: 'Origem',
    destination: 'Destino',
  },
};

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenantId, name: 'Tenant QA' } }),
}));

vi.mock('@/hooks/useCurrentDriver', () => ({
  useCurrentDriver: () => ({
    data: { id: mock.driverId, name: 'Motorista QA', active: true, tenant_id: mock.tenantId },
    isLoading: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
  useActiveTrip: () => ({
    data: trip,
    isLoading: false,
    isPending: false,
    isError: false,
    error: null,
    refetch: vi.fn(),
  }),
}));

vi.mock('@/hooks/useChecklistStatus', () => ({
  useChecklistStatus: () => ({ isLoading: true }),
}));

vi.mock('@/hooks/useDriverTripActions', () => ({
  useDriverTripActions: () => ({ accessTrip: vi.fn(), isStartingTrip: false }),
}));

vi.mock('@/components/driver/NoLoadsHelp', () => ({ default: () => null }));
vi.mock('@/components/driver/DriverLoadNotes', () => ({ default: () => null }));
vi.mock('@/components/driver/DriverDeliveryMap', () => ({
  default: ({ vehicle }: { vehicle: { lat: number; lng: number } | null }) => (
    <div data-testid="driver-delivery-map">
      {vehicle ? `${vehicle.lat},${vehicle.lng}` : 'sem posição atual'}
    </div>
  ),
}));

vi.mock('@/integrations/supabase/client', () => {
  const responseFor = (table: string) => {
    if (table === 'loads') return { data: [], error: null };
    if (table === 'dispatch_stops') {
      return {
        data: [{
          id: '60000000-0000-4000-8000-000000000001',
          stop_order: 1,
          destination: 'Destino',
          status: 'pending',
          latitude: -15.8,
          longitude: -43.3,
          clients: { company_name: 'Cliente QA' },
        }],
        error: null,
      };
    }
    return { data: [], error: null };
  };

  return {
    supabase: {
      rpc: async (
        name: string,
        args: { _tenant_id: string; _vehicle_id: string },
      ) => {
        if (name !== 'get_workspace_vehicle_position_v1') {
          return { data: null, error: { message: `unexpected RPC: ${name}` } };
        }
        mock.positionCalls += 1;
        mock.positionRpcArgs.push(args);
        if (mock.positionShouldFail) {
          return { data: null, error: { message: 'internal telemetry detail' } };
        }
        return {
          data: [{ lat: -15.802, lng: -43.313, captured_at: new Date().toISOString() }],
          error: null,
        };
      },
      from: (table: string) => {
        const builder: Record<string, unknown> = {};
        builder.select = () => builder;
        builder.eq = () => builder;
        builder.not = () => builder;
        builder.order = () => builder;
        builder.limit = () => builder;
        builder.maybeSingle = async () => responseFor(table);
        builder.then = (
          resolve: (value: { data: unknown; error: unknown }) => unknown,
          reject?: (reason: unknown) => unknown,
        ) => Promise.resolve(responseFor(table)).then(resolve, reject);
        return builder;
      },
      channel: () => {
        const channel = {
          on: () => channel,
          subscribe: () => channel,
        };
        return channel;
      },
      removeChannel: vi.fn(),
    },
  };
});

let queryClient: QueryClient;

function renderHome() {
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter>
        <DriverHome />
      </MemoryRouter>
    </QueryClientProvider>,
  );
}

beforeEach(() => {
  mock.positionShouldFail = true;
  mock.positionCalls = 0;
  mock.positionRpcArgs = [];
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

describe('driver home tracking', () => {
  it('fails visibly, keeps the trip map and retries the same tenant-scoped vehicle query', async () => {
    renderHome();

    await screen.findByRole('alert');
    expect(screen.getByText('Posição do veículo indisponível')).toBeInTheDocument();
    expect(screen.queryByText('internal telemetry detail')).not.toBeInTheDocument();
    expect(screen.getByTestId('driver-delivery-map')).toHaveTextContent('sem posição atual');
    expect(mock.positionRpcArgs).toEqual([{
      _tenant_id: mock.tenantId,
      _vehicle_id: mock.vehicleId,
    }]);

    mock.positionShouldFail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar atualizar posição' }));

    await waitFor(() => {
      expect(screen.getByTestId('driver-delivery-map')).toHaveTextContent('-15.802,-43.313');
    });
    expect(screen.queryByText('Posição do veículo indisponível')).not.toBeInTheDocument();
    expect(mock.positionCalls).toBe(2);
    expect(mock.positionRpcArgs).toEqual([
      { _tenant_id: mock.tenantId, _vehicle_id: mock.vehicleId },
      { _tenant_id: mock.tenantId, _vehicle_id: mock.vehicleId },
    ]);
  });

  it('keeps low-cost foreground polling explicit in the query contract', () => {
    const source = readFileSync(join(process.cwd(), 'src', 'hooks', 'useDriverHomeVehiclePosition.ts'), 'utf8');
    expect(source).toContain(".rpc('get_workspace_vehicle_position_v1'");
    expect(source).toContain('refetchInterval: 30_000');
    expect(source).toContain('refetchIntervalInBackground: false');
    expect(source).toContain('retry: false');
  });
});
