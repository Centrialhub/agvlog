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
  it('starts a planned trip and invalidates driver and operation views before navigation', async () => {
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => result.current.accessTrip('trip', 'planned', null));
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalledWith('/driver/stops?trip=trip'));
    expect(mocks.rpc).toHaveBeenCalledWith('driver_start_trip', { _trip_id: 'trip' });
    for (const key of ['driver_active_trip','driver_my_trips','driver_my_loads','driver_all_assigned_loads','driver_trip','driver_stops','dispatch_trips','loads']) {
      expect(invalidate).toHaveBeenCalledWith({ queryKey: [key] });
    }
  });
  it('does not navigate or report success when the backend refuses departure', async () => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code: '23514', message: 'Carga bloqueada pela operação' } });
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => result.current.accessTrip('trip', 'planned'));
    await waitFor(() => expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({ description: 'Carga bloqueada pela operação', variant: 'destructive' }));
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
  it('keeps the action pending until the view refresh completes', async () => {
    let release: () => void = () => undefined;
    const pending = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(client, 'invalidateQueries').mockReturnValue(pending);
    const { result } = renderHook(useDriverTripActions, { wrapper });
    act(() => result.current.accessTrip('trip', 'planned'));
    await waitFor(() => expect(result.current.isStartingTrip).toBe(true));
    expect(mocks.navigate).not.toHaveBeenCalled();
    await act(async () => release());
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled());
    await waitFor(() => expect(result.current.isStartingTrip).toBe(false));
  });
  it.each(['40001','40P01','55P03'])('refreshes both sides and requires manual retry after %s',async code=>{
    const invalidate=vi.spyOn(client,'invalidateQueries');mocks.rpc.mockResolvedValue({data:null,error:{code,message:'technical lock conflict'}});
    const {result}=renderHook(useDriverTripActions,{wrapper});act(()=>result.current.accessTrip('trip','planned'));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:expect.stringContaining('Outra operação alterou')}));
    expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(mocks.navigate).not.toHaveBeenCalled();
    for(const key of ['loads','load','load_trip_state','driver_my_loads','dispatch_trips'])expect(invalidate).toHaveBeenCalledWith({queryKey:[key]});
  });
  it('does not claim success from a missing/uncertain start response',async()=>{
    mocks.rpc.mockResolvedValue({data:null,error:null});const {result}=renderHook(useDriverTripActions,{wrapper});
    act(()=>result.current.accessTrip('trip','planned'));await waitFor(()=>expect(mocks.toast).toHaveBeenCalled());
    expect(mocks.navigate).not.toHaveBeenCalled();expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:expect.stringContaining('Não foi possível confirmar')}));
  });
  it('ignores a second immediate click while start and refresh are pending',async()=>{
    const {result}=renderHook(useDriverTripActions,{wrapper});act(()=>{result.current.accessTrip('trip','planned');result.current.accessTrip('trip','planned');});
    await waitFor(()=>expect(mocks.navigate).toHaveBeenCalled());expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });
  it('still reports the mutation rejection if a follow-up refresh fails',async()=>{
    vi.spyOn(client,'invalidateQueries').mockRejectedValue(new Error('offline'));
    mocks.rpc.mockResolvedValue({data:null,error:{code:'23514',message:'Carga bloqueada'}});
    const {result}=renderHook(useDriverTripActions,{wrapper});act(()=>result.current.accessTrip('trip','planned'));
    await waitFor(()=>expect(mocks.toast).toHaveBeenCalledWith(expect.objectContaining({description:'Carga bloqueada'})));
    expect(mocks.navigate).not.toHaveBeenCalled();
  });
});
