import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import Drivers from '@/pages/Drivers';
import Vehicles from '@/pages/Vehicles';

const mock = vi.hoisted(() => ({
  tenant: '43000000-0000-4000-8000-000000000001',
  actor: '43000000-0000-4000-8000-000000000002',
  driver: '43000000-0000-4000-8000-000000000003',
  vehicle: '43000000-0000-4000-8000-000000000004',
  rpc: vi.fn(),
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Transportadora QA' } }),
  useIsAdmin: () => false,
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/hooks/useTenantCapabilities', () => ({
  useTenantCapabilities: () => ({ isEnabled: () => false }),
}));
vi.mock('@/hooks/useAlertStore', () => ({
  useScopedAlerts: () => ({ confirmAction: vi.fn() }),
}));
vi.mock('@/hooks/useSonnerToast', () => ({
  useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }),
}));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    rpc: mock.rpc,
    from: vi.fn(),
    functions: { invoke: vi.fn() },
  },
}));

const createdAt = '2026-09-01T12:00:00.000Z';
const driver = {
  id: mock.driver,
  tenant_id: mock.tenant,
  created_at: createdAt,
  updated_at: createdAt,
  name: 'Ana Motorista',
  active: true,
  current_vehicle_id: mock.vehicle,
  current_vehicle: { id: mock.vehicle, plate: 'ABC1D23', nickname: 'Truck QA' },
  user_id: null,
  doc: '123',
  phone: '11999999999',
  provider_person_sync_status: null,
};
const vehicle = {
  id: mock.vehicle,
  tenant_id: mock.tenant,
  created_at: createdAt,
  updated_at: createdAt,
  plate: 'ABC1D23',
  nickname: 'Truck QA',
  type: 'truck',
  active: true,
  tags: [],
  current_driver_id: mock.driver,
  current_driver: { id: mock.driver, name: 'Ana Motorista' },
  body_type: 'baú',
};

function response(resource: string) {
  return {
    version: 1,
    tenant_id: mock.tenant,
    actor_id: mock.actor,
    resource,
    items: resource === 'drivers' ? [driver] : [vehicle],
    next_cursor: null,
  };
}

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.rpc.mockImplementation((_name: string, args: { _resource: string }) => (
    Promise.resolve({ data: response(args._resource), error: null })
  ));
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function renderScreen(screenNode: React.ReactNode) {
  return render(
    <MemoryRouter>
      <QueryClientProvider client={queryClient}>{screenNode}</QueryClientProvider>
    </MemoryRouter>,
  );
}

describe('operator driver and vehicle registries', () => {
  it('renders the complete driver catalog with its assigned vehicle', async () => {
    renderScreen(<Drivers />);
    expect(await screen.findByText('Ana Motorista')).toBeInTheDocument();
    expect(screen.getByText(/ABC1D23/)).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('list_operator_reference_page_v1', expect.objectContaining({
      _resource: 'drivers',
      _include_inactive: true,
    }));
  });

  it('renders the safe vehicle catalog with its assigned driver', async () => {
    renderScreen(<Vehicles />);
    expect(await screen.findByText('ABC1D23')).toBeInTheDocument();
    expect(screen.getByText('Ana Motorista')).toBeInTheDocument();
    expect(screen.queryByText(/tracker_password/i)).not.toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('list_operator_reference_page_v1', expect.objectContaining({
      _resource: 'vehicles',
      _include_inactive: true,
    }));
  });
});
