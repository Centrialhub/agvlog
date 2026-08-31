import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import PortalDocuments from '@/pages/portal/PortalDocuments';

const mocks = vi.hoisted(() => ({ query: vi.fn(), client: 'client-a' }));
vi.mock('@/components/portal/PortalLayout', () => ({ PortalSection: ({ children }: { children: ReactNode }) => <main>{children}</main> }));
vi.mock('@/hooks/portal/usePortalClientScope', () => ({ usePortalClientScope: () => ({ can: () => false, selectedClientId: mocks.client }) }));
vi.mock('@/hooks/portal/usePortalDocuments', () => ({ usePortalDocuments: (filters: { offset: number }) => {
  mocks.query(filters);
  const count = filters.offset === 0 ? 50 : 1;
  return { data: Array.from({ length: count }, (_, index) => ({ id: `${filters.offset + index}`, invoice_number: `NF-${filters.offset + index}`, document_type: 'nfe' })), isLoading: false };
} }));
afterEach(() => { cleanup(); mocks.query.mockClear(); mocks.client = 'client-a'; });

describe('portal document filtering and pagination', () => {
  it('can return from a last page shorter than the page size', () => {
    render(<MemoryRouter><PortalDocuments /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(screen.getByRole('button', { name: 'Próxima' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Anterior' })).toBeEnabled();
    fireEvent.click(screen.getByRole('button', { name: 'Anterior' }));
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
  });
  it('applies a one-character search and resets pagination when filtering or changing client scope', () => {
    const view = render(<MemoryRouter><PortalDocuments /></MemoryRouter>);
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    fireEvent.change(screen.getByLabelText('Buscar documento'), { target: { value: '4' } });
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ search: '4', offset: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    mocks.client = 'client-b';
    view.rerender(<MemoryRouter><PortalDocuments /></MemoryRouter>);
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
    fireEvent.click(screen.getByRole('button', { name: 'Limpar filtros' }));
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ search: undefined, offset: 0 }));
  });
});
