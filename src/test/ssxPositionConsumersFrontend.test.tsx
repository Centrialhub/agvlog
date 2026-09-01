import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useFleetState } from '@/hooks/useVehiclesState';

const mock = vi.hoisted(() => ({
  tenantId: '20000000-0000-4000-8000-000000000001',
  filters: [] as Array<{ table: string; column: string; value: unknown }>,
  states: [] as Record<string, unknown>[],
  positions: [] as Record<string, unknown>[],
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenantId, name: 'Tenant QA' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      const result = () => Promise.resolve({
        data: table === 'vehicles_state' ? mock.states : mock.positions,
        error: null,
      });
      const builder = {
        select: () => builder,
        eq: (column: string, value: unknown) => {
          mock.filters.push({ table, column, value });
          return builder;
        },
        then: <TResult1 = unknown, TResult2 = never>(
          onFulfilled?: ((value: Awaited<ReturnType<typeof result>>) => TResult1 | PromiseLike<TResult1>) | null,
          onRejected?: ((reason: unknown) => TResult2 | PromiseLike<TResult2>) | null,
        ) => result().then(onFulfilled, onRejected),
      };
      return builder;
    },
  },
}));

let client: QueryClient;

function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.filters = [];
  mock.states = [{
    vehicle_id: '50000000-0000-4000-8000-000000000001',
    tenant_id: mock.tenantId,
    lat: -23,
    lng: -46,
    speed: 0,
    heading: null,
    movement_state: 'stopped',
    last_movement_at: null,
    last_position_at: '2026-08-31T17:59:00.000Z',
    stopped_since: '2026-08-31T17:58:00.000Z',
    stopped_duration_seconds: 60,
    updated_at: '2026-08-31T18:00:00.000Z',
  }];
  mock.positions = [];
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('SSX position consumers in React', () => {
  it('queries both state and observation inside the selected tenant', async () => {
    const { result } = renderHook(() => useFleetState(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(mock.filters).toEqual(expect.arrayContaining([
      { table: 'vehicles_state', column: 'tenant_id', value: mock.tenantId },
      { table: 'positions_last', column: 'tenant_id', value: mock.tenantId },
    ]));
  });

  it('does not render an orphan state row as a stopped vehicle', async () => {
    const { result } = renderHook(() => useFleetState(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]).toMatchObject({
      movement_state: 'unknown',
      speed: null,
      last_position_at: null,
      lat: null,
      lng: null,
      stopped_duration_seconds: 0,
    });
  });

  it('keeps a fresh observation with unknown speed in the unknown state', async () => {
    mock.positions = [{
      vehicle_id: '50000000-0000-4000-8000-000000000001',
      captured_at: new Date().toISOString(),
      lat: -22.9,
      lng: -46.1,
      speed: null,
      heading: 90,
    }];
    const { result } = renderHook(() => useFleetState(), { wrapper: Wrapper });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data?.[0]).toMatchObject({
      movement_state: 'unknown',
      speed: null,
      lat: -22.9,
      lng: -46.1,
      heading: 90,
    });
  });
});
