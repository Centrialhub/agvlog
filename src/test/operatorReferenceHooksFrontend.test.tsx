import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useLoads } from '@/hooks/useLoads';
import { useClients } from '@/hooks/useClients';
import { useVehicles } from '@/hooks/useVehicles';
import { useOperationalRoutes } from '@/hooks/useOperationalRoutes';
import { useDrivers } from '@/hooks/useDrivers';

const mock = vi.hoisted(() => ({
  tenant: '42000000-0000-4000-8000-000000000001',
  actor: '42000000-0000-4000-8000-000000000002',
  rpc: vi.fn(),
  failSecondLoadPage: false,
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));

const scope = 'b'.repeat(64);
const at = (page: number) => `2026-09-01T${String(20 - page).padStart(2, '0')}:00:00.000Z`;
const ids: Record<string, [string, string]> = {
  loads: ['42000000-0000-4000-8000-000000000011', '42000000-0000-4000-8000-000000000012'],
  clients: ['42000000-0000-4000-8000-000000000021', '42000000-0000-4000-8000-000000000022'],
  drivers: ['42000000-0000-4000-8000-000000000051', '42000000-0000-4000-8000-000000000052'],
  vehicles: ['42000000-0000-4000-8000-000000000031', '42000000-0000-4000-8000-000000000032'],
  operational_routes: ['42000000-0000-4000-8000-000000000041', '42000000-0000-4000-8000-000000000042'],
};
const item = (resource: string, page: 1 | 2) => ({
  id: ids[resource][page - 1],
  tenant_id: mock.tenant,
  created_at: at(page),
  ...(resource === 'loads' ? { load_number: `LOAD-${page}`, status: 'planned' } : {}),
  ...(resource === 'clients' ? { company_name: page === 1 ? 'Zulu' : 'Alfa', active: true } : {}),
  ...(resource === 'drivers' ? { name: page === 1 ? 'Zeca' : 'Ana', active: true } : {}),
  ...(resource === 'vehicles' ? { plate: page === 1 ? 'ZZZ9Z99' : 'AAA1A11', active: true } : {}),
  ...(resource === 'operational_routes' ? { name: page === 1 ? 'Zona Sul' : 'Centro', active: true } : {}),
});
const response = (resource: string, page: 1 | 2) => ({
  version: 1,
  tenant_id: mock.tenant,
  actor_id: mock.actor,
  resource,
  items: [item(resource, page)],
  next_cursor: page === 1 ? {
    scope,
    snapshot_at: '2026-09-01T21:00:00.000Z',
    created_at: at(page),
    id: ids[resource][0],
  } : null,
});

let client: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  mock.failSecondLoadPage = false;
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.rpc.mockImplementation((_name: string, args: { _resource: string; _cursor: null | { id: string } }) => {
    const page = args._cursor ? 2 : 1;
    if (args._resource === 'loads' && page === 2 && mock.failSecondLoadPage) {
      return Promise.resolve({ data: null, error: new Error('segunda página indisponível') });
    }
    return Promise.resolve({ data: response(args._resource, page), error: null });
  });
});

afterEach(() => {
  cleanup();
  client.clear();
});

function Story() {
  const loads = useLoads();
  const clients = useClients();
  const vehicles = useVehicles();
  const routes = useOperationalRoutes();
  const drivers = useDrivers();
  if (loads.isError) return <div role="alert">{String(loads.error)}</div>;
  if (loads.isPending || clients.isPending || vehicles.isPending || routes.isPending || drivers.isPending) return <div>Carregando</div>;
  return <div>
    <span>Cargas: {(loads.data ?? []).length}</span>
    <span>Clientes: {(clients.data ?? []).map(row => row.company_name).join(',')}</span>
    <span>Veículos: {(vehicles.data ?? []).map(row => row.plate).join(',')}</span>
    <span>Rotas: {(routes.data ?? []).map(row => row.name).join(',')}</span>
    <span>Motoristas: {(drivers.data ?? []).map(row => row.name).join(',')}</span>
  </div>;
}

function App() {
  return <QueryClientProvider client={client}><Story /></QueryClientProvider>;
}

describe('complete operator reference catalogs', () => {
  it('loads every cursor page and preserves the UI sorting contract', async () => {
    render(<App />);
    expect(await screen.findByText('Cargas: 2')).toBeInTheDocument();
    expect(screen.getByText('Clientes: Alfa,Zulu')).toBeInTheDocument();
    expect(screen.getByText('Veículos: AAA1A11,ZZZ9Z99')).toBeInTheDocument();
    expect(screen.getByText('Rotas: Centro,Zona Sul')).toBeInTheDocument();
    expect(screen.getByText('Motoristas: Ana,Zeca')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledTimes(10);
    expect(new Set(mock.rpc.mock.calls.map(([, args]) => args._resource)))
      .toEqual(new Set(['loads', 'clients', 'drivers', 'vehicles', 'operational_routes']));
  });

  it('does not present a truncated first page as success after a later failure', async () => {
    mock.failSecondLoadPage = true;
    render(<App />);
    expect(await screen.findByRole('alert')).toHaveTextContent('segunda página indisponível');
    expect(screen.queryByText('Cargas: 1')).not.toBeInTheDocument();
  });
});
