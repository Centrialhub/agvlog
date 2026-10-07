import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import PendingDocsGrouping from '@/components/loads/PendingDocsGrouping';

type Row = Record<string, unknown>;
const state = vi.hoisted(() => ({ rows: [] as Row[], requests: [] as URL[], submit: vi.fn() }));
vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: 'tenant' } }) }));
vi.mock('@/hooks/useVehicles', () => ({ useVehicles: () => ({ data: [] }) }));
vi.mock('@/hooks/useDrivers', () => ({ useDrivers: () => ({ data: [] }) }));
vi.mock('@/hooks/useOperationalRoutes', () => ({ useOperationalRoutes: () => ({ data: [
  { id: 'jaiba', name: 'Jaíba', destinations: [{ name: 'JAÍBA' }] },
  { id: 'espinosa', name: 'Espinosa', destinations: [{ name: 'ESPINOSA' }] },
] }) }));
vi.mock('@/hooks/useLoadCreation', () => ({ useLoadCreation: () => ({
  submit: state.submit, pending: [], error: '', isPending: false,
}) }));
vi.mock('@/hooks/useSonnerToast', () => ({ useSonnerToast: () => ({ success: vi.fn(), error: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', async () => {
  const { createClient } = await import('@supabase/supabase-js');
  return { supabase: createClient('https://fixture.invalid', 'test-key', {
    auth: { persistSession: false, autoRefreshToken: false },
    global: { fetch: async input => {
      const url = new URL(String(input));
      state.requests.push(url);
      let rows = state.rows;
      for (const key of ['tenant_id', 'status', 'document_type']) {
        const expression = url.searchParams.get(key);
        if (expression) rows = rows.filter(row => row[key] === expression.slice(3));
      }
      for (const key of ['load_id', 'deleted_at']) {
        if (url.searchParams.get(key) === 'is.null') rows = rows.filter(row => row[key] == null);
      }
      const offset = Number(url.searchParams.get('offset') || 0);
      const limit = Number(url.searchParams.get('limit') || rows.length);
      // Return only queried scalar columns so an omitted eligibility field cannot
      // be supplied accidentally by a mock with a complete document object.
      const fields = (url.searchParams.get('select') || '').split(',').filter(key => /^[a-z_]+$/.test(key));
      const projected = rows.slice(offset, offset + limit).map(row =>
        Object.fromEntries(fields.map(key => [key, row[key] ?? null])));
      return new Response(JSON.stringify(projected), { status: 200 });
    } },
  }) };
});
vi.mock('@/components/ui/dialog', () => ({
  Dialog: ({ open, children }: { open: boolean; children: ReactNode }) => open ? <div>{children}</div> : null,
  DialogContent: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogHeader: ({ children }: { children: ReactNode }) => <div>{children}</div>,
  DialogTitle: ({ children }: { children: ReactNode }) => <h1>{children}</h1>,
  DialogDescription: ({ children }: { children: ReactNode }) => <p>{children}</p>,
}));
vi.mock('@/components/ui/select', () => ({
  Select: ({ children, value, onValueChange, disabled }: {
    children: ReactNode; value: string; onValueChange: (value: string) => void; disabled?: boolean;
  }) => <select value={value} disabled={disabled} onChange={event => onValueChange(event.target.value)}>{children}</select>,
  SelectContent: ({ children }: { children: ReactNode }) => <>{children}</>,
  SelectItem: ({ value }: { value: string }) => <option value={value}>{value}</option>,
  SelectTrigger: () => null, SelectValue: () => null,
}));

function note(id: string, city: string, overrides: Row = {}): Row {
  return {
    id, recipient_city: city, tenant_id: 'tenant', document_type: 'inbound',
    status: 'confirmed', load_id: null, deleted_at: null,
    pallet_count: 1, weight_kg: 10, value: 100, created_at: '2026-10-05T12:00:00Z',
    current_delivery_attempt_id: null, cte_emitted_at: null, cte_emitted_outbound_id: null, nfse_emitted_at: null,
    ...overrides,
  };
}
let client: QueryClient;
beforeEach(() => {
  state.requests = []; state.rows = [];
  state.submit.mockResolvedValue({ load: { load_number: '1031' }, document_count: 2 });
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); vi.clearAllMocks(); });

describe('pending group eligibility at the real query boundary', () => {
  it.each(['cte_emitted_at', 'cte_emitted_outbound_id', 'nfse_emitted_at'])('keeps first assignment but excludes previously operated %s notes and refreshed totals', async issuedField => {
    state.rows = [
      note('safe', 'JAÍBA'),
      note('first-issued', 'JAÍBA', { [issuedField]: 'issued' }),
      note('already-operated', 'JAÍBA', { [issuedField]: 'issued', current_delivery_attempt_id: 'attempt', pallet_count: 10, weight_kg: 1000, value: 10000 }),
      note('other-city', 'ESPINOSA'),
      note('foreign', 'JAÍBA', { tenant_id: 'other-tenant' }),
      note('deleted', 'JAÍBA', { deleted_at: '2026-10-05T12:00:00Z' }),
      note('linked', 'JAÍBA', { load_id: 'other-load' }),
    ];
    render(<QueryClientProvider client={client}><PendingDocsGrouping open onOpenChange={vi.fn()} onCreated={vi.fn()} /></QueryClientProvider>);
    await screen.findByRole('button', { name: 'Criar 2 Carga(s)' });
    expect(screen.getByText('3 NF-es pendentes')).toBeInTheDocument();
    expect(screen.getByText('2 paletes')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Juntar outro grupo a Jaíba' }));
    fireEvent.click(screen.getByRole('button', { name: 'Adicionar Espinosa' }));
    expect(state.submit).not.toHaveBeenCalled();
    expect(screen.getByText('3 paletes')).toBeInTheDocument();
    expect(screen.getByText('30 kg')).toBeInTheDocument();
    expect(screen.getByText('R$ 300')).toBeInTheDocument();
    state.rows = state.rows.map(row => row.id === 'first-issued' ? { ...row, current_delivery_attempt_id: 'new-attempt' } : row);
    await act(async () => { await client.invalidateQueries({ queryKey: ['pending_fiscal_docs', 'tenant'] }); });
    expect(await screen.findByText('2 NF-es pendentes')).toBeInTheDocument();
    expect(screen.getByText('2 paletes')).toBeInTheDocument();
    expect(screen.getByText('20 kg')).toBeInTheDocument();
    expect(screen.getByText('R$ 200')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Criar 1 Carga(s)' }));
    await waitFor(() => expect(state.submit).toHaveBeenCalledTimes(1));
    expect(state.submit).toHaveBeenCalledWith('Jaíba', {
      changes: { destination: 'Jaíba - Espinosa', vehicle_id: null, driver_id: null }, document_ids: ['safe', 'other-city'],
    });
  });
});
