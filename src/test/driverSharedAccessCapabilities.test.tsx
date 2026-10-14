// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DriverAccessControls } from '@/components/drivers/DriverAccessControls';
const fixture=vi.hoisted(()=>({invoke:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:fixture.invoke}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'synthetic-actor'}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:vi.fn(),error:vi.fn()})}));
afterEach(cleanup);
beforeEach(()=>fixture.invoke.mockReset());
const capabilities={create_access:false,change_password:false,change_identity:false,delete_identity:false,unlink:false};
function mount(target:'driver'|'member') {
  const client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});
  return render(<QueryClientProvider client={client}><DriverAccessControls tenantId="synthetic-company"
    {...(target==='driver'?{driverId:'synthetic-driver'}:{userId:'synthetic-member'})}/></QueryClientProvider>);
}
describe('shared account capabilities in both management entry points',()=>{
  it.each(['driver','member'] as const)('shows the valid %s link without delete advice or a retry loop',async target=>{
    fixture.invoke.mockResolvedValue({error:null,data:{version:2,kind:'linked',username:null,active:true,capabilities}});
    mount(target);
    await screen.findByText('Conta de acesso vinculada.');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.queryByRole('button',{name:'Tentar novamente'})).toBeNull();
    expect(screen.queryByRole('button',{name:'Criar acesso'})).toBeNull();
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
    expect(screen.queryByText(/Use.*Excluir contas antigas/)).toBeNull();
    expect(fixture.invoke).toHaveBeenCalledOnce();
    expect(fixture.invoke.mock.calls[0][1].body).toMatchObject({action:'inspect',version:3,tenant_id:'synthetic-company'});
  });
  it('renders a legacy inspection as a valid account instead of a deletion prerequisite',async()=>{
    fixture.invoke.mockResolvedValue({error:null,data:{version:2,kind:'legacy',username:null,active:true,capabilities}});
    mount('member'); await screen.findByText('Conta de acesso vinculada.');
    expect(screen.queryByText(/Use.*Excluir contas antigas/)).toBeNull();
  });
  it('honors the server creation capability for an inactive unlinked registry',async()=>{
    fixture.invoke.mockResolvedValue({error:null,data:{version:2,kind:'none',username:null,active:false,capabilities}});
    mount('driver'); await screen.findByText('A criação de acesso requer um cadastro ativo.');
    expect(screen.queryByLabelText('Senha inicial')).toBeNull();
  });
  it('still presents an actual inspection transport failure as an error',async()=>{
    fixture.invoke.mockResolvedValue({error:null,data:{error:'synthetic read failure'}});
    mount('driver'); await waitFor(()=>expect(screen.queryByRole('alert')).not.toBeNull());
    expect(screen.queryByText('Conta de acesso vinculada.')).toBeNull();
  });
});
