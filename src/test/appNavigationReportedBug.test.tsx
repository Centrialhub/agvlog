import { lazy, type ReactNode } from 'react';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { Link, Route, Routes } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import App from '@/App';
import { ClientRoute, DriverRoute, ProtectedRoute } from '@/app/routeGuards';

const state = vi.hoisted(() => ({ role: 'operator', destination: null as ReactNode }));
vi.mock('@/hooks/useAuth', () => ({
  AuthProvider: ({ children }: { children: ReactNode }) => children,
  useAuth: () => ({ user: { id: 'actor' }, loading: false }),
}));
vi.mock('@/hooks/useTenant', () => ({
  TenantProvider: ({ children }: { children: ReactNode }) => children,
  useTenant: () => ({ currentRole: state.role, loading: false }),
}));
vi.mock('@/hooks/useTenantCapabilities', () => ({ useTenantCapabilities: () => ({}) }));
vi.mock('@/components/financial/FinanceAccessBoundary', () => ({
  FinanceAccessBoundary: ({ children }: { children: ReactNode }) => children,
}));
vi.mock('@/components/integrations/IntegrationUnavailable', () => ({ IntegrationUnavailable: () => null }));
vi.mock('@/pages/Auth', () => ({ default: () => null }));
vi.mock('@/components/GlobalAlert', () => ({ GlobalAlert: () => null }));
vi.mock('@/components/ui/toaster', () => ({ Toaster: () => null }));
vi.mock('@/components/ui/sonner', () => ({ Toaster: () => null }));
vi.mock('@/components/layout/AppLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/components/layout/DriverLayout', () => ({
  default: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));
vi.mock('@/app/AppRoutes', () => ({
  AppRoutes: () => {
    const Guard = state.role === 'driver' ? DriverRoute : state.role === 'client' ? ClientRoute : ProtectedRoute;
    return <>
      <nav aria-label="Navegação de teste">
        <Link to="/vehicles">Veículos</Link>
        <Link to="/reports">Relatórios</Link>
        <Link to="/clients">Clientes</Link>
      </nav>
      <Routes>
        <Route path="/vehicles" element={<Guard><h1>Lista de veículos</h1></Guard>} />
        <Route path="/reports" element={<Guard>{state.destination}</Guard>} />
        <Route path="/clients" element={<Guard><h1>Lista de clientes</h1></Guard>} />
      </Routes>
    </>;
  },
}));

function show() {
  let finish!: () => void;
  const Page = lazy(() => new Promise<{ default: () => ReactNode }>(resolve => {
    finish = () => resolve({ default: () => <h1>Relatórios carregados</h1> });
  }));
  state.destination = <Page />;
  window.history.replaceState(null, '', '/vehicles');
  render(<App />);
  return () => act(async () => { finish(); });
}

afterEach(() => {
  cleanup();
  state.role = 'operator';
  state.destination = null;
  window.history.replaceState(null, '', '/');
});

describe('navigation while the next page module is loading', () => {
  it.each(['operator', 'driver', 'client'])('shows loading instead of the previous page for %s', async role => {
    state.role = role;
    const finish = show();
    expect(screen.getByRole('heading', { name: 'Lista de veículos' })).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Relatórios' }));
    expect(window.location.pathname).toBe('/reports');
    expect(screen.getByText('Carregando...')).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Lista de veículos' })).not.toBeInTheDocument();
    await finish();
    expect(await screen.findByRole('heading', { name: 'Relatórios carregados' })).toBeVisible();
    await act(async () => { window.history.back(); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Lista de veículos' })).toBeVisible());
    expect(window.location.pathname).toBe('/vehicles');
    await act(async () => { window.history.forward(); });
    await waitFor(() => expect(screen.getByRole('heading', { name: 'Relatórios carregados' })).toBeVisible());
    expect(window.location.pathname).toBe('/reports');
  });

  it('lets another navigation finish while the previous module is still pending', async () => {
    const finish = show();
    fireEvent.click(screen.getByRole('link', { name: 'Relatórios' }));
    expect(screen.getByText('Carregando...')).toBeVisible();
    fireEvent.click(screen.getByRole('link', { name: 'Clientes' }));
    expect(window.location.pathname).toBe('/clients');
    expect(screen.getByRole('heading', { name: 'Lista de clientes' })).toBeVisible();
    await finish();
    expect(screen.getByRole('heading', { name: 'Lista de clientes' })).toBeVisible();
    expect(screen.queryByRole('heading', { name: 'Relatórios carregados' })).not.toBeInTheDocument();
  });
});
