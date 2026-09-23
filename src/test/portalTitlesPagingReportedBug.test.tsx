import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import PortalTitles from '@/pages/portal/PortalTitles';

const mocks = vi.hoisted(() => ({
  total: 100,
  query: vi.fn(),
}));

vi.mock('@/components/portal/PortalLayout', () => ({
  PortalSection: ({ children }: { children: ReactNode }) => <main>{children}</main>,
}));

vi.mock('@/hooks/portal/usePortalClientScope', () => ({
  usePortalClientScope: () => ({
    selectedClientId: 'client-a',
    clients: [{ client_id: 'client-a' }],
    can: () => true,
  }),
}));

vi.mock('@/hooks/portal/usePortalFinancialTitles', () => ({
  usePortalFinancialTitles: (filters: { offset: number }) => {
    mocks.query(filters);
    const inRange = filters.offset < mocks.total;
    return {
      data: {
        rows: inRange ? [{
          id: `title-${filters.offset}`,
          invoice_number: `NF-${filters.offset}`,
          description: null,
          due_date: '2026-09-21',
          status: 'open',
          amount: 100,
          outstanding_amount: 100,
          has_pdf: false,
          can_download: false,
        }] : [],
        total: mocks.total,
      },
      isLoading: false,
      error: null,
      refetch: vi.fn(),
      isFetching: false,
    };
  },
  useDownloadPortalFinancialTitle: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

afterEach(() => {
  cleanup();
  mocks.total = 100;
  mocks.query.mockClear();
});

describe('portal titles pagination', () => {
  it('returns to the last valid page when revalidation shrinks the result set', async () => {
    const view = render(<PortalTitles />);

    fireEvent.click(screen.getByRole('button', { name: 'Próxima' }));
    expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 50 }));

    mocks.total = 40;
    view.rerender(<PortalTitles />);

    await waitFor(() => {
      expect(mocks.query).toHaveBeenLastCalledWith(expect.objectContaining({ offset: 0 }));
    });
    expect(screen.getByText('NF-0')).toBeInTheDocument();
    expect(screen.queryByText('Nenhum título encontrado')).not.toBeInTheDocument();
  });
});
