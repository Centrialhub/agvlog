import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useActiveTrip } from '@/hooks/useCurrentDriver';

type Filter = { table: string; column: string; value: unknown };
const mocks = vi.hoisted(() => ({ filters: [] as Filter[], from: vi.fn() }));

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'actor-a' } }),
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: 'tenant-a' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: { from: mocks.from },
}));

function builder(table: string, response: { data: unknown; error: unknown }) {
  const chain: Record<string, unknown> = {};
  chain.select = () => chain;
  chain.eq = (column: string, value: unknown) => {
    mocks.filters.push({ table, column, value });
    return chain;
  };
  chain.in = () => chain;
  chain.order = () => chain;
  chain.limit = () => chain;
  chain.maybeSingle = async () => response;
  chain.then = (
    resolve: (value: { data: unknown; error: unknown }) => unknown,
    reject?: (reason: unknown) => unknown,
  ) => Promise.resolve(response).then(resolve, reject);
  return chain;
}

let client: QueryClient;
const wrapper = ({ children }: { children: ReactNode }) => (
  <QueryClientProvider client={client}>{children}</QueryClientProvider>
);

beforeEach(() => {
  vi.clearAllMocks();
  mocks.filters = [];
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

describe('active driver trip tenant isolation', () => {
  it('scopes active-trip reads and cache identity to actor and tenant', async () => {
    mocks.from.mockImplementation((table: string) => builder(table, table === 'dispatch_trips'
      ? { data: [], error: null }
      : { data: [], error: null }));

    const { result } = renderHook(() => useActiveTrip('driver-a'), { wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mocks.filters).toEqual(expect.arrayContaining([
      { table: 'dispatch_trips', column: 'tenant_id', value: 'tenant-a' },
      { table: 'dispatch_trips', column: 'driver_id', value: 'driver-a' },
      { table: 'loads', column: 'tenant_id', value: 'tenant-a' },
      { table: 'loads', column: 'driver_id', value: 'driver-a' },
    ]));
    expect(client.getQueryCache().findAll().map((query) => query.queryKey)).toContainEqual([
      'driver_active_trip', 'actor-a', 'tenant-a', 'driver-a',
    ]);
  });
});
