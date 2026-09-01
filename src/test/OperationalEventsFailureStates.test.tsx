import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import OperationalEvents from '@/pages/OperationalEvents';

const state = vi.hoisted(() => ({
  global: {} as Record<string, unknown>,
  filtered: {} as Record<string, unknown>,
  invalidateQueries: vi.fn(),
}));

vi.mock('@/hooks/useOperationalEvents', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/hooks/useOperationalEvents')>();
  return {
    ...actual,
    useOperationalEvents: () => state.global,
    useOperationalEventsFiltered: () => state.filtered,
    useCreateOperationalEvent: () => ({ isPending: false, mutateAsync: vi.fn() }),
    useUpdateOperationalEvent: () => ({ isPending: false, mutateAsync: vi.fn() }),
  };
});
vi.mock('@/hooks/useLoads', () => ({ useLoads: () => ({ data: [] }) }));
vi.mock('@/hooks/useClients', () => ({ useClients: () => ({ data: [] }) }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-1' } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: 'actor-1' } }) }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: vi.fn() }) }));
vi.mock('@/components/driver/DriverConversation', () => ({
  DriverConversation: () => null,
  EventConversation: () => null,
}));
vi.mock('@tanstack/react-query', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@tanstack/react-query')>();
  return {
    ...actual,
    useQuery: () => ({ data: [] }),
    useQueryClient: () => ({ invalidateQueries: state.invalidateQueries }),
  };
});
vi.mock('@/integrations/supabase/client', () => {
  const channel = {
    on: vi.fn(() => channel),
    subscribe: vi.fn(() => channel),
  };
  return {
    supabase: {
      channel: vi.fn(() => channel),
      removeChannel: vi.fn(),
    },
  };
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('OperationalEvents failure states', () => {
  it('never turns failed total and filtered reads into zero counts or empty reports', () => {
    state.global = {
      data: undefined,
      error: new Error('falha geral QA'),
      isPending: false,
      isError: true,
      refetch: vi.fn(),
    };
    state.filtered = {
      data: undefined,
      error: new Error('falha filtrada QA'),
      isLoading: false,
      isError: true,
      isFetching: false,
      refetch: vi.fn(),
    };

    render(<MemoryRouter><OperationalEvents /></MemoryRouter>);

    expect(screen.getByText('indisponível')).toBeInTheDocument();
    expect(screen.getByText(/Totais indisponíveis/)).toBeInTheDocument();
    expect(screen.getAllByText('—')).toHaveLength(4);
    expect(screen.getByText('falha geral QA')).toBeInTheDocument();
    expect(screen.getByText('falha filtrada QA')).toBeInTheDocument();
    expect(screen.getByText('Responsabilidade indisponível enquanto a consulta não puder ser confirmada.')).toBeInTheDocument();
    expect(screen.getByText('Ocorrências por motorista indisponíveis enquanto a consulta não puder ser confirmada.')).toBeInTheDocument();
    expect(screen.queryByText('Sem dados nos últimos 12 meses')).not.toBeInTheDocument();
    expect(screen.queryByText('Sem ocorrências no período')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhuma ocorrência registrada')).not.toBeInTheDocument();
  });
});
