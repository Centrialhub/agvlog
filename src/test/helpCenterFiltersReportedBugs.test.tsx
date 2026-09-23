import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import HelpCenter, { canOpenHelpPath } from '@/pages/HelpCenter';

const access = vi.hoisted(() => ({ role: 'operator', finance: false, fiscal: false, loading: false }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentRole: access.role }) }));
vi.mock('@/hooks/useFinanceLedger', () => ({ useFinanceAccess: () => ({
  data: access.finance, isFetchedAfterMount: !access.loading, error: null,
}) }));
vi.mock('@/hooks/useTenantCapabilities', () => ({ useTenantCapabilities: () => ({
  isEnabled: (capability: string) => capability === 'fiscal' && access.fiscal,
  isLoading: access.loading, error: null,
}) }));
beforeEach(() => { access.role = 'operator'; access.finance = false; access.fiscal = false; access.loading = false; });

describe('filtros da Central de Ajuda', () => {
  it('só oferece atalhos que o perfil atual consegue abrir', () => {
    expect(canOpenHelpPath('driver', '/driver/loads')).toBe(true);
    expect(canOpenHelpPath('driver', '/driver/unknown')).toBe(false);
    expect(canOpenHelpPath('driver', '/loads')).toBe(false);
    expect(canOpenHelpPath('operator', '/driver/stops')).toBe(false);
    expect(canOpenHelpPath('operator', '/loads')).toBe(true);
    expect(canOpenHelpPath('operator', '/team')).toBe(false);
    expect(canOpenHelpPath('admin', '/team')).toBe(true);
    expect(canOpenHelpPath('client', '/loads')).toBe(false);
    expect(canOpenHelpPath(null, '/loads')).toBe(false);
    expect(canOpenHelpPath('operator', '/financial')).toBe(false);
    expect(canOpenHelpPath('operator', '/financial', { financeAvailable: true })).toBe(true);
    expect(canOpenHelpPath('operator', '/cte-hub')).toBe(false);
    expect(canOpenHelpPath('operator', '/cte-hub', { capabilityAvailable: capability => capability === 'fiscal' })).toBe(true);
    expect(canOpenHelpPath('operator', '/missing-screen')).toBe(false);
  });

  it('só habilita atalhos fiscais e financeiros após confirmar ambos os acessos', () => {
    const view = render(<MemoryRouter initialEntries={['/help']}><HelpCenter /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Central CT-e' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Painel financeiro' })).not.toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Cargas' }).length).toBeGreaterThan(0);

    access.finance = true; access.fiscal = true;
    view.rerender(<MemoryRouter initialEntries={['/help']}><HelpCenter /></MemoryRouter>);
    expect(screen.getAllByRole('link', { name: 'Central CT-e' }).length).toBeGreaterThan(0);
    expect(screen.getAllByRole('link', { name: 'Painel financeiro' }).length).toBeGreaterThan(0);

    access.loading = true;
    view.rerender(<MemoryRouter initialEntries={['/help']}><HelpCenter /></MemoryRouter>);
    expect(screen.queryByRole('link', { name: 'Central CT-e' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Painel financeiro' })).not.toBeInTheDocument();
  });

  it('oculta a orientação contextual quando sua categoria não está renderizada', () => {
    render(<MemoryRouter initialEntries={['/help?from=/events']}><HelpCenter /></MemoryRouter>);
    expect(screen.getByRole('link', { name: /Ver orientação/i })).toHaveAttribute('href', '#acompanhar-entrega');

    fireEvent.click(screen.getByRole('button', { name: 'Fiscal e financeiro' }));

    expect(screen.queryByRole('link', { name: /Ver orientação/i })).not.toBeInTheDocument();
    expect(document.getElementById('acompanhar-entrega')).toBeNull();
  });

  it('restaura busca e categoria ao pedir todos os guias', () => {
    render(<MemoryRouter initialEntries={['/help']}><HelpCenter /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Fiscal e financeiro' }));
    fireEvent.change(screen.getByRole('textbox', { name: 'Buscar na central de ajuda' }), {
      target: { value: 'termo sem qualquer resultado' },
    });

    fireEvent.click(screen.getByRole('button', { name: 'Ver todos os guias' }));

    expect(screen.getByRole('button', { name: 'Todas' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByText('Usar o aplicativo do motorista')).toBeInTheDocument();
  });
});
