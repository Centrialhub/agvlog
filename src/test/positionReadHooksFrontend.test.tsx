import type { PropsWithChildren } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useVehicleHistory } from '@/hooks/usePositions';

type HistoryRow = {
  id: string;
  tenant_id: string;
  vehicle_id: string;
  captured_at: string;
  received_at: string;
  lat: number;
  lng: number;
  speed: number | null;
  heading: number | null;
};

const mock = vi.hoisted(() => ({
  tenantId: '20000000-0000-4000-8000-000000000001',
  vehicleId: '50000000-0000-4000-8000-000000000001',
  calls: [] as Array<{ name: string; args: Record<string, unknown> }>,
  pages: [] as Array<{ data: HistoryRow[] | null; error: { message: string } | null }>,
  directRawReads: 0,
}));

vi.mock('@/hooks/useTenant', () => ({
  useTenant: () => ({ currentTenant: { id: mock.tenantId, name: 'Tenant QA' } }),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    from: (table: string) => {
      if (table === 'positions_raw') mock.directRawReads += 1;
      throw new Error(`unexpected direct table read: ${table}`);
    },
    rpc: (name: string, args: Record<string, unknown>) => {
      mock.calls.push({ name, args });
      return {
        abortSignal: async () => mock.pages.shift() || { data: [], error: null },
      };
    },
  },
}));

let client: QueryClient;

function Wrapper({ children }: PropsWithChildren) {
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}

function point(index: number): HistoryRow {
  const second = String(index % 60).padStart(2, '0');
  const minute = String(Math.floor(index / 60) % 60).padStart(2, '0');
  return {
    id: `90000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`,
    tenant_id: mock.tenantId,
    vehicle_id: mock.vehicleId,
    captured_at: `2026-09-01T10:${minute}:${second}.000Z`,
    received_at: `2026-09-01T10:${minute}:${second}.500Z`,
    lat: -23 - index / 10_000,
    lng: -46 - index / 10_000,
    speed: 20,
    heading: 90,
  };
}

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  mock.calls = [];
  mock.pages = [];
  mock.directRawReads = 0;
});

afterEach(() => {
  cleanup();
  client.clear();
});

describe('position read hooks', () => {
  it('uses the bounded RPC and advances the keyset cursor without reading positions_raw directly', async () => {
    const firstPage = Array.from({ length: 500 }, (_, index) => point(index));
    const finalPoint = point(500);
    mock.pages = [
      { data: firstPage, error: null },
      { data: [finalPoint], error: null },
    ];

    const { result } = renderHook(
      () => useVehicleHistory(
        mock.vehicleId,
        '2026-09-01T00:00:00.000Z',
        '2026-09-02T00:00:00.000Z',
      ),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isSuccess).toBe(true));

    expect(result.current.data).toHaveLength(501);
    expect(mock.directRawReads).toBe(0);
    expect(mock.calls).toHaveLength(2);
    expect(mock.calls[0]).toEqual({
      name: 'list_vehicle_position_history_v1',
      args: expect.objectContaining({
        _tenant_id: mock.tenantId,
        _vehicle_id: mock.vehicleId,
        _after_captured_at: null,
        _after_id: null,
        _page_size: 500,
      }),
    });
    expect(mock.calls[1]).toEqual({
      name: 'list_vehicle_position_history_v1',
      args: expect.objectContaining({
        _after_captured_at: firstPage[499].captured_at,
        _after_id: firstPage[499].id,
        _page_size: 500,
      }),
    });
  });

  it('propagates backend failures instead of converting them to an empty history', async () => {
    mock.pages = [{ data: null, error: { message: 'forbidden' } }];

    const { result } = renderHook(
      () => useVehicleHistory(
        mock.vehicleId,
        '2026-09-01T00:00:00.000Z',
        '2026-09-02T00:00:00.000Z',
      ),
      { wrapper: Wrapper },
    );
    await waitFor(() => expect(result.current.isError).toBe(true));

    expect(result.current.data).toBeUndefined();
    expect(result.current.error).toMatchObject({ message: 'forbidden' });
    expect(mock.calls).toHaveLength(1);
    expect(mock.directRawReads).toBe(0);
  });
});
