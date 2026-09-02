import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useClientsPage } from '@/hooks/useClients';
import { clearOperatorClientPageAnchors } from '@/lib/operator/operatorClientPagination';

const mock = vi.hoisted(() => ({
  tenant: '45000000-0000-4000-8000-000000000001',
  actor: '45000000-0000-4000-8000-000000000002',
  rpc: vi.fn(),
  from: vi.fn(),
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenant, name: 'Empresa QA' } }),
}));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: mock.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({
  supabase: { rpc: mock.rpc, from: mock.from },
}));

let queryClient: QueryClient;

beforeEach(() => {
  vi.clearAllMocks();
  clearOperatorClientPageAnchors();
  queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.rpc.mockResolvedValue({
    data: {
      version: 1,
      tenant_id: mock.tenant,
      actor_id: mock.actor,
      resource: 'clients',
      snapshot_at: '2026-09-01T20:00:00.000Z',
      items: [{
        id: '45000000-0000-4000-8000-000000000011',
        tenant_id: mock.tenant,
        company_name: 'Cliente completo',
        created_at: '2026-09-01T12:00:00.000Z',
        active: true,
      }],
      total_count: 1,
      previous_cursor: null,
      next_cursor: null,
    },
    error: null,
  });
});

afterEach(() => {
  cleanup();
  queryClient.clear();
});

function Story() {
  const query = useClientsPage({ page: 1, pageSize: 50, search: 'completo', kind: 'client' });
  if (query.isPending) return <div>Carregando</div>;
  if (query.isError) return <div role="alert">{String(query.error)}</div>;
  return <div>{query.data?.rows.map(client => client.company_name).join(',')} — {query.data?.totalCount}</div>;
}

describe('operator client registry frontend', () => {
  it('renders the keyset RPC result without a direct Data API range read', async () => {
    render(<QueryClientProvider client={queryClient}><Story /></QueryClientProvider>);
    expect(await screen.findByText('Cliente completo — 1')).toBeInTheDocument();
    expect(mock.rpc).toHaveBeenCalledWith('list_operator_clients_page_v1', expect.objectContaining({
      _search: 'completo',
      _kind: 'client',
      _direction: 'next',
      _cursor: null,
    }));
    expect(mock.from).not.toHaveBeenCalled();
  });
});
