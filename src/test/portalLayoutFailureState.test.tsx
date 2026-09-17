import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { describe, expect, it, vi } from 'vitest';

import PortalLayout from '@/components/portal/PortalLayout';

const mocks = vi.hoisted(() => ({ refetch: vi.fn(), signOut: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ signOut: mocks.signOut }),
}));

vi.mock('@/hooks/portal/useClientPortalAccess', () => ({
  useClientPortalAccess: () => ({
    data: undefined,
    isLoading: false,
    isFetching: false,
    error: new Error('backend detail must stay hidden'),
    refetch: mocks.refetch,
  }),
}));

describe('portal access failure state', () => {
  it('keeps portal data hidden and offers retry instead of reporting an empty access list', () => {
    render(<MemoryRouter><PortalLayout /></MemoryRouter>);

    expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível confirmar seu acesso');
    expect(screen.queryByText(/ainda não possui acesso a nenhum cliente/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/backend detail/i)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(mocks.refetch).toHaveBeenCalledTimes(1);
  });
});
