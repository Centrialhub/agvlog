import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import DispatchRecoveryPanel from '@/components/route-planning/DispatchRecoveryPanel';
import {createDispatchOutbox,type DispatchWirePayload} from '@/lib/route-planning/dispatchOutbox';

const mock=vi.hoisted(()=>({rpc:vi.fn(),tenant:{id:'tenant'},user:{id:'actor'}}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:mock.tenant})}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.user})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
const trip='80000000-0000-4000-8000-000000000001';
let client:QueryClient;
const show=(onConfirmed=vi.fn(),loadId?:string)=>render(<QueryClientProvider client={client}>
  <DispatchRecoveryPanel onConfirmed={onConfirmed} loadId={loadId}/></QueryClientProvider>);
beforeEach(()=>{vi.clearAllMocks();localStorage.clear();mock.tenant={id:'tenant'};mock.user={id:'actor'};
  Object.defineProperty(navigator,'locks',{configurable:true,value:{request:(_key:string,work:()=>Promise<unknown>)=>work()}});
  mock.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:trip,error:null})}));
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();});
const pending=async()=>{
  const outbox=createDispatchOutbox({storage:localStorage,uuid:()=>crypto.randomUUID(),lock:async(_key,work)=>work(),send:async()=>{throw new Error('Offline');}});
  const payload:DispatchWirePayload={tenant_id:'tenant',driver_id:'driver',vehicle_id:'vehicle',planned_start_at:'2030-01-01T10:00:00Z',
    load_ids:['load'],stops:[],planning_draft_id:null,route_name:'Rota preservada'};
  await expect(outbox.dispatch('tenant','actor','scope',payload)).rejects.toThrow();
};
describe('dispatch recovery UI',()=>{
  it('stays absent with no pending request',()=>{show();expect(screen.queryByRole('region')).not.toBeInTheDocument();});
  it('offers explicit recovery, confirms exactly once and removes the pending card',async()=>{
    await pending();const confirmed=vi.fn();show(confirmed);
    expect(screen.getByText(/Rota preservada/)).toBeInTheDocument();expect(mock.rpc).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));
    await waitFor(()=>expect(confirmed).toHaveBeenCalledWith(expect.objectContaining({scope:'scope'}),trip));
    expect(mock.rpc).toHaveBeenCalledTimes(1);expect(screen.queryByRole('region')).not.toBeInTheDocument();
  });
  it('keeps an accessible error and retry after permission failure on an uncertain commit',async()=>{
    await pending();mock.rpc.mockImplementation(()=>({abortSignal:()=>Promise.resolve({data:null,error:{code:'42501',message:'Sem permissão'}})}));
    const confirmed=vi.fn();show(confirmed);fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');expect(confirmed).not.toHaveBeenCalled();
    expect(screen.getByRole('button',{name:'Recuperar despacho'})).toBeEnabled();expect(localStorage.length).toBe(1);
  });
  it('hides other loads and other users without discarding their requests',async()=>{
    await pending();const view=show(vi.fn(),'different-load');expect(screen.queryByRole('region')).not.toBeInTheDocument();view.unmount();
    mock.user={id:'another-actor'};show();expect(screen.queryByRole('region')).not.toBeInTheDocument();expect(localStorage.length).toBe(1);
  });
  it('disables recovery while a response is pending',async()=>{
    await pending();let release!:(value:unknown)=>void;const response=new Promise(resolve=>{release=resolve;});
    mock.rpc.mockImplementation(()=>({abortSignal:()=>response}));show();fireEvent.click(screen.getByRole('button',{name:'Recuperar despacho'}));
    expect(screen.getByRole('button',{name:'Recuperando…'})).toBeDisabled();
    await act(async()=>{release({data:trip,error:null});});expect(mock.rpc).toHaveBeenCalledTimes(1);
  });
});
