import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import Dashboard from '@/pages/Dashboard';

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), navigate: vi.fn() }));

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: undefined,
    error: new Error('Falha controlada'),
    isError: true,
    isLoading: false,
    isPending: false,
    refetch: () => mocks.refetch(queryKey[0]),
  }),
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-a', name: 'Empresa QA' } }),
}));

vi.mock('@/hooks/useVehiclesState', () => ({
  useFleetState: () => ({ data: [], error: null, isLoading: false, refetch: vi.fn() }),
}));

vi.mock('@/hooks/useVehicles', () => ({
  useVehicles: () => ({
    data: undefined,
    error: new Error('Veículos indisponíveis'),
    isError: true,
    isLoading: false,
    refetch: () => mocks.refetch('vehicles'),
  }),
}));

vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));

afterEach(() => {
  cleanup();
  mocks.refetch.mockClear();
  mocks.navigate.mockClear();
});

describe('dashboard query failures', () => {
  it('shows unavailable states instead of valid-looking zeros and empty collections', () => {
    render(<Dashboard />);

    expect(screen.getByText(/Parte dos dados do Dashboard está indisponível/)).toBeInTheDocument();
    expect(screen.getByText('Métricas semanais indisponíveis')).toBeInTheDocument();
    expect(screen.getByText('Quilometragem por veículo indisponível')).toBeInTheDocument();
    expect(screen.getByText('Alertas recentes indisponíveis')).toBeInTheDocument();
    expect(screen.getByText('Eventos recentes indisponíveis')).toBeInTheDocument();
    expect(screen.getByText('Veículos offline indisponíveis')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum alerta')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum evento nas últimas 24h')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sem dados de métricas/)).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByRole('button', { name: 'Tentar novamente' })[0]);
    expect(new Set(mocks.refetch.mock.calls.map(([key]) => key))).toEqual(new Set([
      'dashboard_vehicles', 'dashboard_alerts', 'dashboard_metrics', 'dashboard_weekly',
      'vehicles', 'dashboard_recent_alerts', 'dashboard_recent_events',
    ]));
  });
});
