import {act,cleanup,renderHook} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PropsWithChildren} from 'react';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {useSavePlanSnapshot} from '@/hooks/useRoutePlanningDrafts';

const mock=vi.hoisted(()=>({existing:null as null|{updated_at:string;status:string},saved:{id:'route',updated_at:'new'} as unknown,
  writes:vi.fn(),eq:vi.fn(),writeError:null as unknown,readError:null as unknown}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant'}})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor'}})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{from:()=>{
  let write=false;
  const chain={select:()=>chain,eq:(...args:unknown[])=>{mock.eq(write,...args);return chain;},
    update:(payload:unknown)=>{write=true;mock.writes('update',payload);return chain;},
    insert:(payload:unknown)=>{write=true;mock.writes('insert',payload);return chain;},
    maybeSingle:async()=>write?{data:mock.saved,error:mock.writeError}:{data:mock.existing,error:mock.readError}};
  return chain;
}}}));
let client:QueryClient;
const wrapper=({children}:PropsWithChildren)=><QueryClientProvider client={client}>{children}</QueryClientProvider>;
const input={routeId:'route',name:'Route',snapshot:{loads:[{id:'load'}]}};
beforeEach(()=>{vi.clearAllMocks();mock.existing=null;mock.saved={id:'route',updated_at:'new'};mock.readError=null;mock.writeError=null;
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();});
describe('draft snapshot compare-and-swap',()=>{
  it('inserts a new draft without an upsert that could overwrite another session',async()=>{
    const {result}=renderHook(useSavePlanSnapshot,{wrapper});
    await act(async()=>{expect(await result.current.mutateAsync(input)).toBe('route');});
    expect(mock.writes).toHaveBeenCalledWith('insert',expect.objectContaining({id:'route',tenant_id:'tenant',status:'draft'}));
  });
  it('guards the actual update by tenant, version and draft status',async()=>{
    mock.existing={updated_at:'old',status:'draft'};const {result}=renderHook(useSavePlanSnapshot,{wrapper});
    await act(async()=>{await result.current.mutateAsync(input);});
    for(const [field,value] of [['id','route'],['tenant_id','tenant'],['status','draft'],['updated_at','old']])
      expect(mock.eq).toHaveBeenCalledWith(true,field,value);
  });
  it('rejects an already dispatched draft before any write',async()=>{
    mock.existing={updated_at:'old',status:'dispatched'};const {result}=renderHook(useSavePlanSnapshot,{wrapper});
    await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toMatchObject({name:'DraftConflictError'});});
    expect(mock.writes).not.toHaveBeenCalled();
  });
  it('reports a compare-and-swap race instead of claiming success',async()=>{
    mock.existing={updated_at:'old',status:'draft'};mock.saved=null;const {result}=renderHook(useSavePlanSnapshot,{wrapper});
    await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toMatchObject({name:'DraftConflictError'});});
  });
  it('does not recreate a previously known draft deleted in another session',async()=>{
    const {result}=renderHook(useSavePlanSnapshot,{wrapper});result.current.seedVersion('route','old');
    await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toMatchObject({name:'DraftConflictError'});});
    expect(mock.writes).not.toHaveBeenCalled();
  });
  it('does not write after a read failure',async()=>{
    mock.readError=new Error('offline');const {result}=renderHook(useSavePlanSnapshot,{wrapper});
    await act(async()=>{await expect(result.current.mutateAsync(input)).rejects.toThrow('offline');});expect(mock.writes).not.toHaveBeenCalled();
  });
});
