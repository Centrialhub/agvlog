import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { DriverTenantSwitcher } from '@/components/driver/DriverTenantSwitcher';

const mocks = vi.hoisted(() => ({ activate: vi.fn(), navigate: vi.fn(), online: true,
  state: { currentTenant: { id: 'agv' }, switchingTenant: false, tenantContextError: null as string | null,
    memberships: [
      { tenant_id: 'agv', role: 'driver', tenants: { name: 'AGV' } },
      { tenant_id: 'lira', role: 'driver', tenants: { name: 'LIRA' } },
    ] },
}));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ ...mocks.state, activateTenantId: mocks.activate }) }));
vi.mock('@/hooks/useOnlineStatus', () => ({ useOnlineStatus: () => mocks.online }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));

beforeEach(() => {
  vi.clearAllMocks(); mocks.online = true; mocks.state.switchingTenant = false;
  mocks.state.tenantContextError = null; mocks.activate.mockResolvedValue(true);
});
describe('driver company selection', () => {
  it('activates the signed destination before leaving a company-specific trip page', async () => {
    render(<DriverTenantSwitcher />);
    fireEvent.change(screen.getByLabelText('Empresa do motorista'), { target: { value: 'lira' } });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver', { replace: true }));
    expect(mocks.activate).toHaveBeenCalledExactlyOnceWith('lira');
  });
  it('preserves the current page and reports a refused activation', async () => {
    mocks.activate.mockResolvedValue(false); render(<DriverTenantSwitcher />);
    fireEvent.change(screen.getByLabelText('Empresa do motorista'), { target: { value: 'lira' } });
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível trocar');
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
  it('prevents switching offline or during another switch', () => {
    mocks.online = false; const view = render(<DriverTenantSwitcher />);
    expect(screen.getByLabelText('Empresa do motorista')).toBeDisabled();
    expect(mocks.activate).not.toHaveBeenCalled();
    mocks.online = true; mocks.state.switchingTenant = true; view.rerender(<DriverTenantSwitcher />);
    expect(screen.getByLabelText('Empresa do motorista')).toBeDisabled();
  });
});
