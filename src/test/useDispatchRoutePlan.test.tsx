import {act,cleanup,renderHook,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PropsWithChildren} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useDispatchRoutePlan,type DispatchRoutePayload} from '@/hooks/route-planning/useDispatchRoutePlan';
import type {RouteStopDraft} from '@/lib/route-planning/routePlanningTypes';

const mock=vi.hoisted(()=>({rpc:vi.fn(),from:vi.fn(),tenant:{id:'tenant'} as {id:string}|null,user:{id:'actor'} as {id:string}|null}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc,from:mock.from}}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:mock.tenant})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.user})}));
const trip='80000000-0000-4000-8000-000000000001';
const stop=(id:string,order:number):RouteStopDraft=>({id,recipient_name:id,destination:id,load_ids:['load'],
  fiscal_document_ids:[`doc-${id}`],invoice_numbers:[],total_weight_kg:1,total_volume_m3:1,total_pallet_count:1,
  total_value:1,latitude:order===1?-23.51:-23.52,longitude:order===1?-46.61:-46.62,
  service_time_minutes:20,priority:0,risk_level:'normal',manual_order:order});
const payload:DispatchRoutePayload={attempt_scope:'route',vehicle_id:'vehicle',driver_id:'driver',planned_start_at:'2026-09-01T12:00:00Z',
  route_name:'Rota QA',load_ids:['load'],stops:[stop('second',2),stop('first',1)],planning_draft_id:'draft'};
let client:QueryClient;
const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(()=>{
  vi.clearAllMocks();mock.tenant={id:'tenant'};mock.user={id:'actor'};localStorage.clear();
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:vi.fn((_key:string,work:()=>Promise<unknown>)=>work())}});
  mock.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:trip,error:null})}));
  mock.from.mockImplementation(()=>{throw new Error('Planning must not access internal idempotency rows');});
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{cleanup();client.clear();});

describe('route planning frontend contract after idempotency RLS hardening',()=>{
  it('dispatches through the existing RPC without reading internal idempotency keys',async()=>{
    const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    await act(async()=>{expect(await result.current.dispatchRoute(payload)).toBe(trip);});
    expect(mock.rpc).toHaveBeenCalledWith('dispatch_planned_route',{_payload:expect.objectContaining({
      tenant_id:'tenant',driver_id:'driver',vehicle_id:'vehicle',load_ids:['load'],planning_draft_id:'draft',
      stops:[expect.objectContaining({destination:'first',latitude:-23.51,longitude:-46.61}),
        expect.objectContaining({destination:'second',latitude:-23.52,longitude:-46.62})],
    })});
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('refreshes operation and driver views after a successful dispatch mutation',async()=>{
    const invalidate=vi.spyOn(client,'invalidateQueries');const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    act(()=>result.current.mutate(payload));await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    for(const key of ['pending_loads_for_routing','loads','dispatch_trips','route_planning_drafts','driver_trip','driver_active_trip','driver_stops'])
      expect(invalidate).toHaveBeenCalledWith({queryKey:[key]});
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('surfaces RPC authorization failure without falling back to direct table access',async()=>{
    mock.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'not_authorized'}})}));
    const {result}=renderHook(useDispatchRoutePlan,{wrapper});act(()=>result.current.mutate(payload));
    await waitFor(()=>expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toBe('not_authorized');expect(mock.rpc).toHaveBeenCalledTimes(1);
    expect(mock.from).not.toHaveBeenCalled();
  });
  it('does not send a request without a selected tenant',async()=>{
    mock.tenant=null;const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    await expect(result.current.dispatchRoute(payload)).rejects.toThrow('Tenant não selecionado');
    expect(mock.rpc).not.toHaveBeenCalled();expect(mock.from).not.toHaveBeenCalled();
  });
  it('uses the new tenant context after rerender instead of a stale tenant',async()=>{
    const {result,rerender}=renderHook(useDispatchRoutePlan,{wrapper});mock.tenant={id:'other-tenant'};rerender();
    await act(async()=>{await result.current.dispatchRoute(payload);});
    expect(mock.rpc).toHaveBeenCalledWith('dispatch_planned_route',{_payload:expect.objectContaining({tenant_id:'other-tenant'})});
  });
  it('refuses an unauthenticated attempt without touching the RPC',async()=>{
    mock.user=null;const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    await expect(result.current.dispatchRoute(payload)).rejects.toThrow('Sessão não autenticada');expect(mock.rpc).not.toHaveBeenCalled();
  });
  it('converts local date/time input to an explicit UTC instant before freezing the request',async()=>{
    const {result}=renderHook(useDispatchRoutePlan,{wrapper});const local='2030-01-01T08:00';
    await act(async()=>{await result.current.dispatchRoute({...payload,planned_start_at:local});});
    expect(mock.rpc.mock.calls[0][1]._payload.planned_start_at).toBe(new Date(local).toISOString());
  });
  it('does not submit a malformed schedule',async()=>{
    const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    await expect(result.current.dispatchRoute({...payload,planned_start_at:'not-a-date'})).rejects.toThrow('data e hora válidas');
    expect(mock.rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
  });
  it('blocks a stop without valid explicit coordinates before creating an outbox request',async()=>{
    const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    const invalid={...payload,stops:[{...payload.stops[0],latitude:null}]};
    await expect(result.current.dispatchRoute(invalid)).rejects.toThrow('latitude e longitude válidas');
    expect(mock.rpc).not.toHaveBeenCalled();expect(localStorage.length).toBe(0);
  });
  it('retains an uncertain reply after remount and explicitly replays the original payload/key',async()=>{
    mock.rpc.mockImplementationOnce(()=>({abortSignal:()=>Promise.resolve({data:null,error:null})}));
    const first=renderHook(useDispatchRoutePlan,{wrapper});
    await act(async()=>{await expect(first.result.current.dispatchRoute(payload)).rejects.toThrow('não confirmou');});
    const original=mock.rpc.mock.calls[0][1];expect(first.result.current.pendingDispatches).toHaveLength(1);first.unmount();
    const second=renderHook(useDispatchRoutePlan,{wrapper});expect(second.result.current.pendingDispatches).toHaveLength(1);
    await act(async()=>{expect(await second.result.current.recoverDispatch('route')).toBe(trip);});
    expect(mock.rpc.mock.calls[1][1]).toEqual(original);expect(second.result.current.pendingDispatches).toHaveLength(0);
  });
  it('refreshes all linked views even on a rejected bare dispatch call',async()=>{
    const invalidate=vi.spyOn(client,'invalidateQueries');
    mock.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:null,error:{code:'40001',message:'dispatch_concurrent_change'}})}));
    const {result}=renderHook(useDispatchRoutePlan,{wrapper});
    await act(async()=>{await expect(result.current.dispatchRoute(payload)).rejects.toMatchObject({code:'40001'});});
    for(const key of ['load','load_trip_state','driver_my_loads','driver_my_trips','route_planning_drafts'])
      expect(invalidate).toHaveBeenCalledWith({queryKey:[key]});
    expect(localStorage.length).toBe(0);expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
  it('never reports an old tenant success after the account context changes during a request',async()=>{
    let release!:(value:unknown)=>void;const response=new Promise(resolve=>{release=resolve;});
    mock.rpc.mockImplementation(()=>({abortSignal:()=>response}));
    const {result,rerender}=renderHook(useDispatchRoutePlan,{wrapper});let request!:Promise<string>;
    act(()=>{request=result.current.dispatchRoute(payload);});await waitFor(()=>expect(mock.rpc).toHaveBeenCalledTimes(1));
    mock.tenant={id:'other-tenant'};rerender();
    await act(async()=>{release({data:trip,error:null});await expect(request).rejects.toThrow('sessão ou empresa mudou');});
    expect(result.current.pendingDispatches).toHaveLength(0);expect(localStorage.length).toBe(1);
  });
});
