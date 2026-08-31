import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter } from 'react-router-dom';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ProductTraceability from '@/pages/ProductTraceability';

const mocks = vi.hoisted(() => ({ select: vi.fn(), ilike: vi.fn(), eq: vi.fn() }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (table: string) => {
  const query = { select: (value: string) => { mocks.select(table, value); return query; },
    ilike: (key: string, value: string) => { mocks.ilike(key, value); return query; },
    eq: (key: string, value: string) => { mocks.eq(key, value); return query; },
    order: () => query, limit: () => query, gte: () => query, lte: () => query,
    then: (resolve: (value: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(resolve),
  }; return query;
} } }));
let client: QueryClient;
beforeEach(() => { vi.clearAllMocks(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); });
afterEach(() => { cleanup(); client.clear(); });

describe('product traceability filters', () => {
  it('waits for Apply and restricts related documents before the result limit', async () => {
    render(<MemoryRouter><QueryClientProvider client={client}><ProductTraceability /></QueryClientProvider></MemoryRouter>);
    await waitFor(() => expect(screen.getByRole('button', { name: 'Aplicar filtros' })).toBeEnabled());
    mocks.select.mockClear();
    fireEvent.change(screen.getByLabelText('Fornecedor'), { target: { value: 'Fornecedor exemplo' } });
    expect(mocks.select).not.toHaveBeenCalled();
    expect(screen.getByText('Há alterações ainda não aplicadas.')).toBeVisible();
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() => expect(mocks.ilike).toHaveBeenCalledWith('fiscal_documents.remitter', '%Fornecedor exemplo%'));
    expect(mocks.select).toHaveBeenCalledWith('load_items', expect.stringContaining('fiscal_documents!inner'));
    expect(screen.getByRole('link', { name: 'Ver notas sem carga' })).toHaveAttribute('href', '/fiscal-documents?load=no_load');
  });
});
