import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';

const mocks = vi.hoisted(() => ({
  failRead: false, contextError: false, checked: [0,1,2,3,4,5,6,7] as unknown[],
  queries: [] as [string,unknown,unknown][][],
  onChange: undefined as undefined | (()=>void),
  refetch: vi.fn(),
}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/hooks/useDriverJourneyContext',()=>({useDriverJourneyContext:()=>({
  data:{last_end:{id:'end',event_at:'2026-08-29T10:00:00.000001Z'},last_start:{id:'start',event_at:'2026-08-29T11:00:00.000001Z'}},
  isError:mocks.contextError,isSuccess:!mocks.contextError,isPending:false,isFetching:false,refetch:mocks.refetch,
})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{
  from:()=>{
    const calls:[string,unknown,unknown][]=[]; mocks.queries.push(calls);
    const chain={
      select:()=>chain,
      eq:(field:string,value:unknown)=>{calls.push(['eq',field,value]);return chain;},
      gt:(field:string,value:unknown)=>{calls.push(['gt',field,value]);return chain;},
      order:(field:string,value:unknown)=>{calls.push(['order',field,value]);return chain;},
      limit:()=>chain,
      maybeSingle:async()=>({data:{id:'saved',event_at:'2026-08-29T12:00:00Z',payload:{checked_items:mocks.checked}},error:mocks.failRead?new Error('offline'):null}),
    }; return chain;
  },
  channel:()=>{const channel={on:(_type:unknown,_filter:unknown,callback:()=>void)=>{mocks.onChange=callback;return channel;},subscribe:()=>channel};return channel;},
  removeChannel:vi.fn(),
}}));
let container:HTMLDivElement; let root:Root; let client:QueryClient;
let status:ReturnType<typeof useChecklistStatus>;
function Probe(){status=useChecklistStatus('trip');return null;}
beforeEach(()=>{
  vi.clearAllMocks(); mocks.failRead=false;mocks.contextError=false;mocks.checked=[0,1,2,3,4,5,6,7];mocks.queries=[];
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});
  container=document.createElement('div');document.body.appendChild(container);root=createRoot(container);
  client=new QueryClient({defaultOptions:{queries:{retry:false}}});
});
afterEach(async()=>{await act(async()=>root.unmount());client.clear();container.remove();});
const render=async()=>act(async()=>root.render(<QueryClientProvider client={client}><Probe/></QueryClientProvider>));
const settle=async()=>vi.waitFor(async()=>{await act(async()=>{await new Promise(resolve=>setTimeout(resolve,0));});expect(status.isLoading).toBe(false);});

describe('checklist query isolation and freshness',()=>{
  it('scopes both queries by actor, tenant and trip, preserving microseconds in shift cutoffs',async()=>{
    await render();await settle();
    expect(mocks.queries).toHaveLength(2);
    for(const query of mocks.queries){
      expect(query).toContainEqual(['eq','tenant_id','tenant']);
      expect(query).toContainEqual(['eq','created_by','actor']);
      expect(query).toContainEqual(['eq','dispatch_trip_id','trip']);
    }
    expect(mocks.queries[0]).toContainEqual(['gt','event_at','2026-08-29T10:00:00.000001Z']);
    expect(mocks.queries[1]).toContainEqual(['gt','event_at','2026-08-29T11:00:00.000001Z']);
    expect(status.preCompleted).toBe(true);expect(status.postCompleted).toBe(false);
  });
  it('does not treat invalid duplicate items as a completed checklist',async()=>{
    mocks.checked=[0,1,2,3,4,5,6,6];await render();await settle();
    expect(status.preCompleted).toBe(false);expect(status.preCheckedCount).toBe(0);
  });
  it('reports read failures instead of silently presenting an empty successful checklist',async()=>{
    mocks.failRead=true;await render();await settle();
    expect(status.isError).toBe(true);expect(status.preCompleted).toBe(false);
  });
  it('does not read checklist data using unknown journey boundaries',async()=>{
    mocks.contextError=true;await render();
    expect(status.isError).toBe(true);expect(mocks.queries).toHaveLength(0);
  });
  it('refreshes both caches when a personal event arrives',async()=>{
    await render();await settle();const invalidate=vi.spyOn(client,'invalidateQueries');
    await act(async()=>mocks.onChange?.());
    expect(invalidate).toHaveBeenCalledWith({queryKey:['driver_journey_events','tenant','actor']});
    expect(invalidate).toHaveBeenCalledWith({queryKey:['checklist_status','tenant','actor']});
  });
});
