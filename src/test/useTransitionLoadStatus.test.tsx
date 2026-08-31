import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { PropsWithChildren } from 'react';
import { afterEach,beforeEach,describe,expect,it,vi } from 'vitest';
import { useTransitionLoadStatus } from '@/hooks/useLoads';

const mocks=vi.hoisted(()=>({rpc:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mocks.rpc}}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'user'}})}));
let client:QueryClient;
const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
beforeEach(()=>{
  vi.clearAllMocks();client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  mocks.rpc.mockResolvedValue({data:{load_id:'load',from_status:'ready',to_status:'loading',changed:true},error:null});
});
afterEach(()=>{cleanup();client.clear();});
describe('operational load transition frontend',()=>{
  it('refreshes the load detail, operation board and driver trip after confirmation',async()=>{
    const invalidate=vi.spyOn(client,'invalidateQueries');const {result}=renderHook(useTransitionLoadStatus,{wrapper});
    act(()=>result.current.mutate({id:'load',status:'loading',reason:'Carregamento QA'}));
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
    expect(mocks.rpc).toHaveBeenCalledWith('transition_load_status_v1',{
      p_tenant_id:'tenant',p_load_id:'load',p_to_status:'loading',p_reason:'Carregamento QA'});
    for(const key of ['loads','load','load_trip_state','load-control','driver_my_loads','dispatch_trips'])
      expect(invalidate).toHaveBeenCalledWith({queryKey:[key]});
  });
  it('keeps the SQL conflict identifiable and refreshes state without automatically retrying',async()=>{
    const invalidate=vi.spyOn(client,'invalidateQueries');mocks.rpc.mockResolvedValue({data:null,error:{code:'40001',message:'trip_graph_concurrent_change'}});
    const {result}=renderHook(useTransitionLoadStatus,{wrapper});act(()=>result.current.mutate({id:'load',status:'loading'}));
    await waitFor(()=>expect(result.current.isError).toBe(true));
    expect(result.current.error).toMatchObject({code:'40001',message:expect.stringContaining('Outra operação alterou')});
    expect(mocks.rpc).toHaveBeenCalledTimes(1);expect(invalidate).toHaveBeenCalledWith({queryKey:['load_trip_state']});
  });
  it.each([null,{load_id:'other',from_status:'ready',to_status:'loading',changed:true},
    {load_id:'load',from_status:'ready',to_status:'delivered',changed:true}])('does not confirm an absent or mismatched response: %j',async data=>{
    mocks.rpc.mockResolvedValue({data,error:null});const {result}=renderHook(useTransitionLoadStatus,{wrapper});
    act(()=>result.current.mutate({id:'load',status:'loading'}));await waitFor(()=>expect(result.current.isError).toBe(true));
    expect(result.current.error?.message).toContain('Não foi possível confirmar o status');expect(result.current.isSuccess).toBe(false);
  });
  it('accepts an explicit unchanged replay of the requested status',async()=>{
    mocks.rpc.mockResolvedValue({data:{load_id:'load',from_status:'loading',to_status:'loading',changed:false},error:null});
    const {result}=renderHook(useTransitionLoadStatus,{wrapper});act(()=>result.current.mutate({id:'load',status:'loading'}));
    await waitFor(()=>expect(result.current.isSuccess).toBe(true));
  });
});
