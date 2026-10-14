// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {DriverAccessControls} from '@/components/drivers/DriverAccessControls';
const fixture=vi.hoisted(()=>({invoke:vi.fn(),success:vi.fn(),error:vi.fn()}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{functions:{invoke:fixture.invoke}}}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:{id:'synthetic-actor'}})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({success:fixture.success,error:fixture.error})}));
const caps={create_access:false,change_password:false,change_identity:true,delete_identity:false,unlink:false};
const legacy={version:3,kind:'legacy',username:null,active:true,capabilities:caps};
const managed={...legacy,kind:'managed',username:'synthetic.driver',capabilities:{...caps,change_identity:false,change_password:true}};
const request='91000000-0000-4000-8000-000000000041';
let client:QueryClient;
beforeEach(()=>{fixture.invoke.mockReset();fixture.success.mockReset();fixture.error.mockReset();client=new QueryClient({defaultOptions:{queries:{retry:false},mutations:{retry:false}}});});
afterEach(()=>{cleanup();client.clear();sessionStorage.clear();});
function mount(member=false){return render(<QueryClientProvider client={client}><DriverAccessControls tenantId="synthetic-company"
  {...(member?{userId:'synthetic-user'}:{driverId:'synthetic-driver'})}/></QueryClientProvider>);}
async function fill(){
  fireEvent.change(await screen.findByLabelText('Usuário'),{target:{value:'synthetic.driver'}});
  fireEvent.change(screen.getByLabelText('Nova senha'),{target:{value:'SyntheticPassword123'}});
  fireEvent.change(screen.getByLabelText('Confirmar senha'),{target:{value:'SyntheticPassword123'}});
}
describe('identified credential command UI',()=>{
  it.each([false,true])('converts from the driver/member entry and explains the operation scope, member=%s',async member=>{
    let done=false;
    fixture.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>{
      if(body.action==='inspect')return {data:done?managed:legacy,error:null};
      if(body.action==='convert'){done=true;return {data:{success:true,state:'succeeded',request_id:body.request_id},error:null};}
      return {data:{state:'succeeded',request_id:body.request_id},error:null};
    });
    mount(member);await fill();expect(screen.getByText(/todos os CNPJs desta operação/)).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Converter acesso'}));
    await waitFor(()=>expect(fixture.success).toHaveBeenCalledWith('Acesso convertido para usuário.'));
    await screen.findByRole('button',{name:'Trocar senha'});
    const writes=fixture.invoke.mock.calls.map(call=>call[1].body).filter(body=>body.action==='convert');
    expect(writes).toHaveLength(1);expect(writes[0].request_id).toMatch(/^[0-9a-f-]{36}$/);
    expect(writes[0]).toMatchObject(member?{user_id:'synthetic-user'}:{driver_id:'synthetic-driver'});
    expect((screen.getByLabelText('Nova senha') as HTMLInputElement).value).toBe('');
  });
  it('keeps an uncertain mutation blocked across close/reopen and uses only status to reconcile',async()=>{
    let statusReady=false;
    fixture.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>{
      if(body.action==='inspect')return {data:legacy,error:null};
      if(body.action==='convert')return {data:null,error:new Error('Synthetic lost response')};
      if(!statusReady)return {data:{state:'unconfirmed',request_id:body.request_id},error:null};
      return {data:{state:'cancelled',request_id:body.request_id},error:null};
    });
    const view=mount();await fill();fireEvent.click(screen.getByRole('button',{name:'Converter acesso'}));
    await screen.findByRole('alert');expect(screen.queryByRole('button',{name:'Converter acesso'})).toBeNull();
    view.unmount();client.clear();client=new QueryClient({defaultOptions:{queries:{retry:false}}});
    mount();await screen.findByRole('alert');
    expect(fixture.invoke.mock.calls.filter(call=>call[1].body.action==='convert')).toHaveLength(1);
    statusReady=true;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
    await screen.findByRole('button',{name:'Converter acesso'});
    expect(fixture.invoke.mock.calls.filter(call=>call[1].body.action==='convert')).toHaveLength(1);
    expect((screen.getByLabelText('Nova senha') as HTMLInputElement).value).toBe('');
  });
  it('recovers the pending server command after local state was lost without resending credentials',async()=>{
    let cancelled=false;
    fixture.invoke.mockImplementation(async(_name:string,{body}:{body:Record<string,unknown>})=>{
      if(body.action==='inspect')return {data:cancelled?legacy:{...legacy,command_pending:true,pending_request_id:request,
        capabilities:{...caps,change_identity:false}},error:null};
      cancelled=true;return {data:{state:'cancelled',request_id:body.request_id},error:null};
    });
    mount();await screen.findByRole('button',{name:'Verificar acesso'});
    expect(screen.queryByLabelText('Nova senha')).toBeNull();
    fireEvent.click(screen.getByRole('button',{name:'Verificar acesso'}));await screen.findByRole('button',{name:'Converter acesso'});
    const status=fixture.invoke.mock.calls.find(call=>call[1].body.action==='credential_status');
    expect(status?.[1].body.request_id).toBe(request);
    expect(fixture.invoke.mock.calls.some(call=>'password' in call[1].body)).toBe(false);
  });
});
