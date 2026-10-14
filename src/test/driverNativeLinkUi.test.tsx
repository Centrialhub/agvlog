// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Drivers from '@/pages/Drivers';
const f=vi.hoisted(()=>({tenant:'tenant-a',actor:'actor-a',admin:true,linked:true,kind:'managed',pending:false,fail:false,
  inspect:vi.fn(),update:vi.fn(),eq:vi.fn(),success:vi.fn(),error:vi.fn()}));
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
  expect(table).toBe('drivers');const chain={update:f.update,eq:f.eq,select:()=>chain,maybeSingle:async()=>({data:{id:'driver-a'},error:null})};
  f.update.mockReturnValue(chain);f.eq.mockReturnValue(chain);return chain;
}}}));
let client:QueryClient;
beforeEach(()=>{
  vi.clearAllMocks();Object.assign(f,{tenant:'tenant-a',actor:'actor-a',admin:true,linked:true,kind:'managed',pending:false,fail:false});
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
describe('native username registry UI protection',()=>{
  it('omits the identity from ordinary edits and offers no unlink control for a native username',async()=>{
    mount();const modal=await open();
    await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(1));
    expect(within(linkSection()).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');
    expect(f.eq.mock.calls).toEqual([['id','driver-a'],['tenant_id','tenant-a'],['updated_at','2026-10-13T00:00:00Z']]);
  });
  it('preserves a confirmed compatible legacy unlink and revalidates it immediately before saving',async()=>{
    f.kind='legacy';mount();const modal=await open();await chooseNone();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.inspect).toHaveBeenCalledTimes(2);expect(f.update.mock.calls[0][0]).toHaveProperty('user_id',null);
  });
  it.each(['managed','pending','error'])('does not write a legacy unlink after inspection changes to %s',async drift=>{
    f.kind='legacy';mount();const modal=await open();await chooseNone();
    if(drift==='managed')f.kind='managed';else if(drift==='pending')f.pending=true;else f.fail=true;
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.update).not.toHaveBeenCalled();
  });
  it.each(['linked','error'])('keeps unknown or restricted identity %s read-only while allowing ordinary registry edits',async kind=>{
    f.kind=kind;if(kind==='error')f.fail=true;mount();const modal=await open();
    await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(1));expect(within(linkSection()).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');
  });
  it('preserves the accountless registry form without inspecting an unrelated identity',async()=>{
    f.linked=false;mount();const modal=await open();expect(within(linkSection()).getByRole('combobox')).toBeEnabled();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');expect(f.inspect).not.toHaveBeenCalled();
  });
  it('discards an unsaved legacy unlink on cancellation and reinspects on reopen',async()=>{
    f.kind='legacy';mount();let modal=await open();await chooseNone();fireEvent.click(within(modal).getByRole('button',{name:'Cancelar'}));
    await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());f.kind='managed';modal=await open();
    await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(2));expect(within(linkSection()).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');
  });
  it.each(['tenant','actor','permission'])('closes registry editing across a %s context change without writing',async change=>{
    f.kind='legacy';const rerender=mount();await open();await chooseNone();
    if(change==='tenant')f.tenant='tenant-b';else if(change==='actor')f.actor='actor-b';else f.admin=false;
    rerender();await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());expect(f.update).not.toHaveBeenCalled();
  });
  it('cancels a held legacy revalidation, ignores duplicate submits and allows a clean reopen',async()=>{
    f.kind='legacy';mount();let modal=await open();await chooseNone();
    let release!:()=>void;
    f.inspect.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({error:null,data:{version:3,driver_id:'driver-a',kind:'legacy'}});}));
    const form=within(modal).getByRole('button',{name:'Salvar'}).closest('form')!;
    fireEvent.submit(form);fireEvent.submit(form);
    await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(2));expect(f.update).not.toHaveBeenCalled();
    fireEvent.click(within(modal).getByRole('button',{name:'Cancelar'}));await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    await act(async()=>{release();});expect(f.update).not.toHaveBeenCalled();
    f.kind='managed';modal=await open();await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(3));
    expect(within(linkSection()).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');
  });
  it.each(['tenant','actor','permission'])('discards a late link authorization after %s changes',async change=>{
    f.kind='legacy';const rerender=mount();const modal=await open();await chooseNone();
    let release!:()=>void;
    f.inspect.mockImplementationOnce(()=>new Promise(resolve=>{release=()=>resolve({error:null,data:{version:3,driver_id:'driver-a',kind:'legacy'}});}));
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(2));
    if(change==='tenant')f.tenant='tenant-b';else if(change==='actor')f.actor='actor-b';else f.admin=false;
    rerender();await waitFor(()=>expect(screen.queryByRole('dialog')).toBeNull());
    await act(async()=>{release();});expect(f.update).not.toHaveBeenCalled();
  });
  it.each(['version','target'])('does not unlock legacy controls from an incompatible %s response',async field=>{
    f.inspect.mockResolvedValue({error:null,data:{version:field==='version'?2:3,driver_id:field==='target'?'foreign-driver':'driver-a',kind:'legacy'}});
    mount();const modal=await open();await waitFor(()=>expect(f.inspect).toHaveBeenCalledTimes(1));
    expect(within(linkSection()).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));await waitFor(()=>expect(f.update).toHaveBeenCalledTimes(1));
    expect(f.update.mock.calls[0][0]).not.toHaveProperty('user_id');
  });
});
