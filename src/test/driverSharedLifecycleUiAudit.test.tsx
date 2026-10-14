// @vitest-environment jsdom
// Successor regression for the frozen UI witness; SQL protection remains separately required.
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor,within} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Drivers from '@/pages/Drivers';
const fixture=vi.hoisted(()=>({update:vi.fn(),eq:vi.fn(),invoke:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:{id:'tenant-a'},currentRole:'admin'}),useIsAdmin:()=>true}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'actor-a'}})}));
vi.mock('@/hooks/useTenantCapabilities',()=>({useTenantCapabilities:()=>({isEnabled:()=>false})}));
vi.mock('@/hooks/useWorkspaceSsxAccounts',()=>({useWorkspaceSsxAccounts:()=>({data:[]})}));
vi.mock('@/hooks/useAlertStore',()=>({useScopedAlerts:()=>({confirmAction:vi.fn()})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:fixture.success,error:fixture.error})}));
vi.mock('@/lib/supabase/fetchAllPages',()=>({fetchAllPostgrestPages:async()=>[]}));
vi.mock('@/lib/operator/operatorReferencePagination',()=>({readOperatorReferenceCatalog:async({resource}:{resource:string})=>resource==='drivers'?[{
  id:'driver-a',tenant_id:'tenant-a',workspace_id:'workspace-a',name:'Synthetic driver',active:true,user_id:'synthetic-created-user',
  current_vehicle:null,driver_type:'terceiro',updated_at:'2026-10-13T00:00:00Z',
}]:[]}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:fixture.invoke},from:(table:string)=>{
  expect(table).toBe('drivers');
  const chain={update:fixture.update,eq:fixture.eq,select:()=>chain,maybeSingle:async()=>({data:{id:'driver-a'},error:null})};
  fixture.update.mockReturnValue(chain);fixture.eq.mockReturnValue(chain);return chain;
}}}));
let client:QueryClient;
afterEach(()=>{cleanup();client?.clear();sessionStorage.clear();vi.clearAllMocks();vi.unstubAllGlobals();});
describe('registry UI link audit witness',()=>{
  it('preserves the native username identity when editing ordinary registry data',async()=>{
    vi.stubGlobal('ResizeObserver',class { observe=vi.fn();unobserve=vi.fn();disconnect=vi.fn(); });
    fixture.invoke.mockResolvedValue({error:null,data:{version:3,driver_id:'driver-a',kind:'managed',username:'synthetic.driver',active:true}});
    client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
    render(<MemoryRouter><QueryClientProvider client={client}><Drivers/></QueryClientProvider></MemoryRouter>);
    fireEvent.click(await screen.findByRole('button',{name:'Editar motorista Synthetic driver'}));
    const modal=await screen.findByRole('dialog',{name:'Editar motorista'});
    const section=within(modal).getByText('Vínculo de usuário (app do motorista)').closest('section')!;
    await waitFor(()=>expect(fixture.invoke).toHaveBeenCalledTimes(1));
    expect(within(section).queryByRole('combobox')).toBeNull();
    fireEvent.click(within(modal).getByRole('button',{name:'Salvar'}));
    await waitFor(()=>expect(fixture.update).toHaveBeenCalledTimes(1));
    expect(fixture.update.mock.calls[0][0]).toMatchObject({tenant_id:'tenant-a',name:'Synthetic driver'});
    expect(fixture.update.mock.calls[0][0]).not.toHaveProperty('user_id');
    expect(fixture.eq.mock.calls).toEqual([['id','driver-a'],['tenant_id','tenant-a'],['updated_at','2026-10-13T00:00:00Z']]);
    expect(fixture.invoke).toHaveBeenCalledWith('manage-driver-access',{body:{tenant_id:'tenant-a',driver_id:'driver-a',action:'inspect',version:3}});
    // The frozen parent preserves the pre-fix UI witness; SQL protection remains separately required.
  });
});
