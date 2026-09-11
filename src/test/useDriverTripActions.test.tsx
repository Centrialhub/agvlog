import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDriverTripActions } from '@/hooks/useDriverTripActions';

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), navigate: vi.fn(), toast: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));
vi.mock('react-router-dom', () => ({ useNavigate: () => mocks.navigate }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: mocks.toast }) }));
let client: QueryClient;
const wrapper = ({ children }: PropsWithChildren) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

beforeEach(() => {
  vi.clearAllMocks();
  client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  mocks.rpc.mockResolvedValue({ data: { trip_id:'trip',status:'in_transit',load_ids:['load'],changed:true }, error: null });
});
afterEach(() => { cleanup(); client.clear(); });

describe('driver trip actions frontend', () => {
  it('enters a started trip without issuing another start RPC', () => {
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => result.current.accessTrip('trip', 'in_transit', '2026-08-29T12:00:00Z'));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.navigate).toHaveBeenCalledWith('/driver/stops?trip=trip');
  });
  it('routes a planned trip through mandatory cargo acceptance instead of starting it directly', async () => {
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => result.current.accessTrip('trip', 'planned', null));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver/cargo?trip=trip'));
    expect(mocks.rpc).not.toHaveBeenCalled();
  });
  it.each([
    { status: 'planned', load: 'in_transit' },
    { status: 'in_transit', load: 'ready' },
    { status: 'in_progress', load: 'in_transit' },
  ])('requires reconciliation instead of inventing a departure for $status / $load', ({ status, load }) => {
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => result.current.accessTrip('trip', status, null, load));
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ title: 'Revisão operacional necessária' }));
  });
  it('never bypasses custody even when the planned trip is opened again', async () => {
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => { result.current.accessTrip('trip', 'planned'); result.current.accessTrip('trip', 'planned'); });
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver/cargo?trip=trip'));
    expect(mocks.rpc).not.toHaveBeenCalled();
    await waitFor(() => expect(result.current.isStartingTrip).toBe(false));
  });
});
