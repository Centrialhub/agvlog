// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Drivers from '@/pages/Drivers';
const f=vi.hoisted(()=>({tenant:'tenant-a',actor:'actor-a',admin:true,linked:true,kind:'managed',pending:false,fail:false,
  inspect:vi.fn(),maybeSingle:vi.fn(),update:vi.fn(),eq:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:f.tenant},currentRole:f.admin?'admin':'operator'}),useIsAdmin:()=>f.admin}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:f.actor}})}));
vi.mock('@/hooks/useTenantCapabilities',()=>({useTenantCapabilities:()=>({isEnabled:()=>false})}));
vi.mock('@/hooks/useWorkspaceSsxAccounts',()=>({useWorkspaceSsxAccounts:()=>({data:[]})}));
vi.mock('@/hooks/useAlertStore',()=>({useScopedAlerts:()=>({confirmAction:vi.fn()})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:f.success,error:f.error})}));
vi.mock('@/lib/supabase/fetchAllPages',()=>({fetchAllPostgrestPages:async()=>[]}));
vi.mock('@/lib/operator/operatorReferencePagination',()=>({readOperatorReferenceCatalog:async({resource}:{resource:string})=>resource==='drivers'?[{
  id:'driver-a',tenant_id:f.tenant,name:'Synthetic driver',active:true,user_id:f.linked?'account-a':null,current_vehicle:null,driver_type:'terceiro',updated_at:'2026-10-13T00:00:00Z',
}]:[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:f.inspect},from:(table:string)=>{
  expect(table).toBe('drivers');const chain={update:f.update,eq:f.eq,select:()=>chain,maybeSingle:f.maybeSingle};
  f.update.mockReturnValue(chain);f.eq.mockReturnValue(chain);return chain;
}}}));
let client:QueryClient;
beforeEach(()=>{
  vi.clearAllMocks();f.maybeSingle.mockResolvedValue({data:{id:'driver-a'},error:null});Object.assign(f,{tenant:'tenant-a',actor:'actor-a',admin:true,linked:true,kind:'managed',pending:false,fail:false});
  vi.stubGlobal('ResizeObserver',class {observe=vi.fn();unobserve=vi.fn();disconnect=vi.fn();});
  f.inspect.mockImplementation(async(name,{body})=>{
    expect(name).toBe('manage-driver-access');expect(body).toEqual({tenant_id:f.tenant,driver_id:'driver-a',action:'inspect',version:3});
    if(f.fail)return {data:null,error:new Error('Synthetic inspection unavailable')};
    return {error:null,data:{version:3,driver_id:'driver-a',kind:f.kind,username:f.kind==='managed'?'native.username':null,active:true,command_pending:f.pending,
      capabilities:{create_access:false,change_password:f.kind==='managed',change_identity:f.kind==='legacy',delete_identity:false,unlink:false}}};
  });
  client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
});
afterEach(()=>{cleanup();client.clear();sessionStorage.clear();vi.unstubAllGlobals();});
function mount(){const page=()=> <MemoryRouter><QueryClientProvider client={client}><Drivers/></QueryClientProvider></MemoryRouter>;const v=render(page());return ()=>v.rerender(page());}
async function open(){fireEvent.click(await screen.findByRole('button',{name:'Editar motorista Synthetic driver'}));return screen.findByRole('dialog',{name:'Editar motorista'});}
function linkSection(){return screen.getByText('Vínculo de usuário (app do motorista)').closest('section')!;}
async function chooseNone(){fireEvent.keyDown(await within(linkSection()).findByRole('combobox'),{key:'ArrowDown'});fireEvent.click(await screen.findByRole('option',{name:'Sem vínculo'}));}

describe('independent inspection and stale write counterproofs',()=>{
  it.each(['throw','null','error-with-data','wrong-version','wrong-driver'])('blocks legacy unlink on reinspection %s',async scenario=>{
    f.kind='legacy';mount();const modal=await open();await chooseNone();
    const data={version:3,driver_id:'driver-a',kind:'legacy',command_pending:false};
    if(scenario==='throw')f.inspect.mockRejectedValueOnce(new Error('Synthetic transport throw'));
    else f.inspect.mockResolvedValueOnce({error:scenario==='error-with-data'?new Error('Synthetic HTTP error'):null,
      data:scenario==='null'?null:{...data,version:scenario==='wrong-version'?2:3,driver_id:scenario==='wrong-driver'?'different-driver':'driver-a'}});
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.update).not.toHaveBeenCalled();
  });
  it.each(['missing','null'])('keeps an initially incomplete pending state %s read-only',async pending=>{
    f.kind='legacy';const data:Record<string,unknown>={version:3,driver_id:'driver-a',kind:'legacy'};
    if(pending==='null')data.command_pending=null;
    f.inspect.mockResolvedValue({error:null,data});mount();await open();
    await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(1));
    await waitFor(()=>expect(within(linkSection()).queryByRole('combobox')).toBeNull());
  });
  it.each(['missing','null'])('does not dispatch unlink when fresh pending state is %s',async pending=>{
    f.kind='legacy';mount();const modal=await open();await chooseNone();
    const data:Record<string,unknown>={version:3,driver_id:'driver-a',kind:'legacy'};
    if(pending==='null')data.command_pending=null;
    f.inspect.mockResolvedValueOnce({error:null,data});fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(2));
    await waitFor(()=>expect(f.error.mock.calls.length+f.success.mock.calls.length).toBeGreaterThan(0));
    expect(f.update).not.toHaveBeenCalled();expect(f.error).toHaveBeenCalled();
  });
  it.each(['stale','sql-denied'])('retains ordinary registry identity and surfaces %s without claiming success',async failure=>{
    mount();const modal=await open();await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(1));
    f.maybeSingle.mockResolvedValueOnce({data:null,error:failure==='sql-denied'?{message:'workspace_driver_link_change_forbidden'}:null});
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.error).toHaveBeenCalled());
    expect(f.update).toHaveBeenCalledTimes(1);expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');
    expect(f.eq.mock.calls).toEqual([['id','driver-a'],['tenant_id','tenant-a'],['updated_at','2026-10-13T00:00:00Z']]);
    expect(f.success).not.toHaveBeenCalled();expect(screen.getByRole('dialog',{name:'Editar motorista'})).toBeVisible();
  });
});
