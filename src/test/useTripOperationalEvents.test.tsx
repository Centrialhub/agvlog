import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { readTripOperationalEvents, useTripOperationalEvents } from '@/hooks/useTripOperationalEvents';

const scope = {
  tenant: '20000000-0000-4000-8000-000000000001',
  actor: '10000000-0000-4000-8000-000000000001',
  trip: '30000000-0000-4000-8000-000000000001',
};

const state = vi.hoisted(() => ({
  rows: [] as unknown[],
  from: vi.fn(),
  select: vi.fn(),
  eq: vi.fn(),
  order: vi.fn(),
  limit: vi.fn(),
  abortSignal: vi.fn(),
}));

vi.mock('@/hooks/useTenant', () => ({ useTenant: () => ({ currentTenant: { id: scope.tenant } }) }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: { id: scope.actor } }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { from: (...args: unknown[]) => state.from(...args) } }));

function occurrence(overrides: Record<string, unknown> = {}) {
  return {
    id: 'event-1', tenant_id: scope.tenant, dispatch_trip_id: scope.trip, load_id: null,
    event_type: 'other', severity: 'medium', description: 'Motorista solicitou apoio.',
    resolved_at: null, created_at: '2026-08-31T20:00:00Z', visible_to_client: false,
    client_action_required: false, public_status: 'reported_by_driver', ...overrides,
  };
}

let client: QueryClient;
beforeEach(() => {
  vi.clearAllMocks();
  state.rows = [occurrence()];
  const builder = {
    select: state.select, eq: state.eq, order: state.order, limit: state.limit, abortSignal: state.abortSignal,
  };
  state.from.mockReturnValue(builder);
  state.select.mockReturnValue(builder);
  state.eq.mockReturnValue(builder);
  state.order.mockReturnValue(builder);
  state.limit.mockReturnValue(builder);
  state.abortSignal.mockImplementation(async () => ({ data: state.rows, error: null }));
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
});
afterEach(() => { cleanup(); client.clear(); });

const wrapper = ({ children }: PropsWithChildren) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

describe('useTripOperationalEvents', () => {
  it('queries only the authenticated tenant and selected trip', async () => {
    const { result } = renderHook(() => useTripOperationalEvents(scope.trip), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(state.from).toHaveBeenCalledWith('operational_events');
    expect(state.eq.mock.calls).toEqual([
      ['tenant_id', scope.tenant],
      ['dispatch_trip_id', scope.trip],
    ]);
    expect(state.limit).toHaveBeenCalledWith(50);
    expect(result.current.data).toEqual(state.rows);
  });

  it('rejects a cross-tenant or cross-trip response instead of rendering it', async () => {
    state.rows = [occurrence({ tenant_id: 'foreign-tenant' })];
    const { result } = renderHook(() => useTripOperationalEvents(scope.trip), { wrapper });
    await waitFor(() => expect(result.current.isError).toBe(true));
    expect(result.current.data).toBeUndefined();
  });
});

describe('readTripOperationalEvents', () => {
  it('rejects malformed payloads', () => {
    expect(() => readTripOperationalEvents({ id: 'not-an-array' }, scope.tenant, scope.trip))
      .toThrow('resposta das ocorrências');
  });
});
