import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import Dashboard from '@/pages/Dashboard';

vi.mock('@tanstack/react-query', () => ({
  useQuery: () => ({ data: undefined, error: null, isError: false, isLoading: true, isPending: true, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant-a', name: 'Empresa QA' } }) }));
vi.mock('@/hooks/useVehiclesState', () => ({
  useFleetState: () => ({ data: [], error: null, isLoading: true, refetch: vi.fn() }),
}));
vi.mock('@/hooks/useVehicles', () => ({
  useVehicles: () => ({ data: undefined, error: null, isError: false, isLoading: true, refetch: vi.fn() }),
}));
vi.mock('react-router-dom', () => ({ useNavigate: () => vi.fn() }));

describe('carregamento das coleções do Dashboard', () => {
  it('não anuncia coleções vazias antes de concluir as consultas', () => {
    render(<Dashboard />);

    expect(screen.getByText('Carregando métricas semanais…')).toBeInTheDocument();
    expect(screen.getByText('Carregando quilometragem por veículo…')).toBeInTheDocument();
    expect(screen.getByText('Carregando alertas recentes…')).toBeInTheDocument();
    expect(screen.getByText('Carregando eventos recentes…')).toBeInTheDocument();
    expect(screen.getByText('Carregando veículos offline…')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum alerta')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum evento nas últimas 24h')).not.toBeInTheDocument();
    expect(screen.queryByText('Nenhum veículo está offline')).not.toBeInTheDocument();
    expect(screen.queryByText(/Sem dados de métricas/)).not.toBeInTheDocument();
  });
});
