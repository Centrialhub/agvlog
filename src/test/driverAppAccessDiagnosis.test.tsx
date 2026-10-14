// @vitest-environment jsdom
import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Route,Routes} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import Auth from '@/pages/Auth';
import {DriverRoute} from '@/app/routeGuards';
import {TenantProvider,useTenant} from '@/hooks/useTenant';
import {clearActiveTenantId} from '@/lib/tenant/activeTenantContext';
const f=vi.hoisted(()=>({user:null as null|{id:string},session:null as null|{access_token:string},login:vi.fn(),rpc:vi.fn(),refresh:vi.fn(),error:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:f.user,session:f.session,loading:false,backendUnavailable:false,signOut:vi.fn()})}));
vi.mock('@/hooks/useSonnerToast',()=>({useSonnerToast:()=>({error:f.error,success:vi.fn(),info:vi.fn()})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{signInWithPassword:f.login,refreshSession:f.refresh},rpc:f.rpc}}));
vi.mock('@/components/layout/DriverLayout',()=>({default:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('@/components/layout/AppLayout',()=>({default:({children}:{children:React.ReactNode})=><>{children}</>}));
vi.mock('@/components/financial/FinanceAccessBoundary',()=>({FinanceAccessBoundary:({children}:{children:React.ReactNode})=><>{children}</>}));
let client:QueryClient;
const jwt=(tenant?:string)=>'fixture.'+btoa(JSON.stringify({sub:'synthetic-actor',...(tenant?{active_tenant_id:tenant}:{})}))+'.fixture';
const reply=(data:unknown,error:unknown=null)=>{const p=Promise.resolve({data,error});return Object.assign(p,{abortSignal:()=>p});};
const row=(tenant:string)=>({tenant_id:tenant,role:'driver',tenant_name:tenant,plan_key:'test',timezone:'UTC'});
function Probe(){const t=useTenant();return <output aria-label="resolved driver context">{t.currentTenant?.id??'none'}:{t.currentRole??'none'}</output>;}
function mountTenant(){return render(<QueryClientProvider client={client}><TenantProvider><Probe/></TenantProvider></QueryClientProvider>);}
beforeEach(()=>{vi.resetAllMocks();localStorage.clear();sessionStorage.clear();clearActiveTenantId();f.user=null;f.session=null;client=new QueryClient({defaultOptions:{queries:{retry:false}}});vi.spyOn(Navigator.prototype,'onLine','get').mockReturnValue(true);f.login.mockResolvedValue({error:null});f.rpc.mockImplementation((name:string)=>reply(name==='get_current_memberships_v1'?[row('tenant-a')]:null));f.refresh.mockResolvedValue({error:null,data:{session:{access_token:jwt()}}});});
afterEach(()=>{cleanup();client.clear();clearActiveTenantId();vi.useRealTimers();vi.restoreAllMocks();});
describe('driver app access incident discriminators',()=>{
 it('routes an anonymous /driver visitor to the username login form',async()=>{
  render(<MemoryRouter initialEntries={['/driver']}><Routes><Route path="/driver" element={<DriverRoute><p>Protected</p></DriverRoute>}/><Route path="/auth" element={<Auth/>}/></Routes></MemoryRouter>);
  expect(await screen.findByLabelText('Usuário')).toBeVisible();expect(screen.queryByText('Protected')).toBeNull();expect(f.login).not.toHaveBeenCalled();
 });
 it('rejects legacy email on driver tab before Auth; explicit email tab preserves legacy login',async()=>{
  render(<MemoryRouter initialEntries={['/auth?access=driver']}><Auth/></MemoryRouter>);
  fireEvent.change(screen.getByLabelText('Usuário'),{target:{value:'legacy@example.test'}});fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'synthetic-password-only'}});fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
  await waitFor(()=>expect(f.error).toHaveBeenCalled());expect(f.login).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Painel e clientes'}));fireEvent.change(screen.getByLabelText('Email'),{target:{value:'legacy@example.test'}});fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'synthetic-password-only'}});fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
  await waitFor(()=>expect(f.login).toHaveBeenCalledWith({email:'legacy@example.test',password:'synthetic-password-only'}));
 });
 it('dispatches normalized new username to Auth without tenant guessing',async()=>{
  render(<MemoryRouter initialEntries={['/auth?access=driver']}><Auth/></MemoryRouter>);fireEvent.change(screen.getByLabelText('Usuário'),{target:{value:' Synthetic.New '}});fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'synthetic-password-only'}});fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
  await waitFor(()=>expect(f.login).toHaveBeenCalledWith({email:'synthetic.new@usuario.com',password:'synthetic-password-only'}));expect(f.rpc).not.toHaveBeenCalled();
 });
 it('uses the confirmed signed tenant rather than the first of two driver memberships',async()=>{
  f.user={id:'synthetic-actor'};f.session={access_token:jwt('tenant-b')};f.rpc.mockImplementation(()=>reply([row('tenant-a'),row('tenant-b')]));mountTenant();
  await waitFor(()=>expect(screen.getByLabelText('resolved driver context')).toHaveTextContent('tenant-b:driver'));expect(f.refresh).not.toHaveBeenCalled();
 });
 it('blocks app rendering with a visible error when refreshed token lacks active tenant claim',async()=>{
  f.user={id:'synthetic-actor'};f.session={access_token:jwt()};mountTenant();
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar a empresa ativa');expect(screen.queryByLabelText('resolved driver context')).toBeNull();expect(f.refresh).toHaveBeenCalledTimes(1);
 });
 it('blocks app rendering when membership RPC fails',async()=>{
  f.user={id:'synthetic-actor'};f.session={access_token:jwt('tenant-a')};f.rpc.mockImplementation(()=>reply(null,new Error('synthetic membership RPC unavailable')));mountTenant();
  expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível confirmar seus acessos');expect(screen.queryByLabelText('resolved driver context')).toBeNull();
 });
 it('shows explicit recovery after deadline if activation RPC never settles',async()=>{
  vi.useFakeTimers();
  f.user={id:'synthetic-actor'};f.session={access_token:jwt()};f.rpc.mockImplementation((name:string)=>name==='get_current_memberships_v1'?reply([row('tenant-a')]):new Promise(()=>{}));mountTenant();
  await act(async()=>{await vi.advanceTimersByTimeAsync(5);});expect(screen.getByRole('status')).toHaveTextContent('Confirmando empresa ativa');await act(async()=>{await vi.advanceTimersByTimeAsync(10001);});
  expect(screen.getByRole('alert')).toHaveTextContent('demorou mais que o esperado');expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeEnabled();expect(screen.getByRole('button',{name:'Sair'})).toBeEnabled();expect(screen.queryByLabelText('resolved driver context')).toBeNull();
 });
});
