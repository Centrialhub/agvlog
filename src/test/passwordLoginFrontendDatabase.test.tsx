import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {MemoryRouter,Routes,Route} from 'react-router-dom';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {SupabaseClient,Factor} from '@supabase/supabase-js';
import type {PropsWithChildren} from 'react';
import {AuthProvider} from '@/hooks/useAuth';
import {AuthRoute,ProtectedRoute} from '@/app/routeGuards';
import DriverSettlements from '@/pages/DriverSettlements';
import {sessionReadersDatabase} from './helpers/sessionReadersDatabase';
import {installPasswordSessionFixture} from './helpers/passwordSessionDatabase';
import {mfaSdkDatabaseGateway} from './helpers/mfaSdkDatabaseGateway';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {installTestWebLocks} from './helpers/testWebLocks';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({client:null as SupabaseClient|null}));
vi.mock('@/integrations/supabase/client',()=>({get supabase(){return mock.client;}}));
vi.mock('@/components/layout/AppLayout',()=>({default:({children}:PropsWithChildren)=><>{children}</>}));
vi.mock('@/components/layout/DriverLayout',()=>({default:({children}:PropsWithChildren)=><>{children}</>}));
vi.mock('@/components/financial/DriverSettlementDrawer',()=>({default:()=>null}));
vi.mock('@/components/financial/NewManualSettlementDialog',()=>({default:()=>null}));
let db:PGlite,query:QueryClient,gateway:ReturnType<typeof mfaSdkDatabaseGateway>,locks:ReturnType<typeof installTestWebLocks>;
beforeAll(async()=>{({db}=await sessionReadersDatabase());await installPasswordSessionFixture(db);},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 locks=installTestWebLocks();await db.exec('begin');await manualSettlement(db);await expenseMfaRole(db,'owner');localStorage.clear();
 query=new QueryClient({defaultOptions:{queries:{retry:false}}});gateway=mfaSdkDatabaseGateway(db);mock.client=gateway.client;gateway.faults.passwordActor=i.operator;
});
afterEach(async()=>{cleanup();query.clear();await gateway.drain();await gateway.client.auth.stopAutoRefresh();locks.restore();await db.exec('rollback');});
const story=(path='/auth')=><QueryClientProvider client={query}><AuthProvider><MemoryRouter initialEntries={[path]}><Routes>
 <Route path="/auth" element={<AuthRoute/>}/>
 <Route path="/" element={<ProtectedRoute><DriverSettlements/></ProtectedRoute>}/>
 <Route path="/driver" element={<p>Portal do motorista QA</p>}/>
</Routes></MemoryRouter></AuthProvider></QueryClientProvider>;
async function login(){
 fireEvent.change(await screen.findByLabelText('Email'),{target:{value:'qa@example.invalid'}});
 fireEvent.change(screen.getByLabelText('Senha'),{target:{value:'Synthetic-Password-123!'}});
 fireEvent.click(screen.getByRole('button',{name:'Entrar'}));
}
const list=(tenant=i.tenant)=>gateway.client.rpc('list_driver_settlements',{_tenant_id:tenant});
const noFactors=()=>expect(gateway.requests.filter(r=>r.path.includes('/factors'))).toHaveLength(0);

describe('password login through real routes, Auth SDK, providers and business SQL',()=>{
 it.each(['owner','admin','operator'])('opens the financial page for an active %s using email/password only',async role=>{
  await expenseMfaRole(db,role);render(story());await login();await screen.findByText('Motorista QA');
  expect((await list()).data).toHaveProperty('total_count',1);
  expect(gateway.requests.some(r=>r.path==='/auth/v1/token')).toBe(true);
  expect(gateway.requests.filter(r=>r.path.endsWith('/list_driver_settlements')).every(r=>r.aal==='aal1')).toBe(true);
  expect(screen.queryByLabelText('Código de 6 dígitos')).not.toBeInTheDocument();noFactors();
 });
 it.each(['verified','unverified'])('does not challenge a previously %s authenticator',async status=>{
  gateway.factors.set(i.operator,[{id:'factor-qa',factor_type:'totp',status,friendly_name:'AGVLog',created_at:new Date().toISOString(),updated_at:new Date().toISOString()} as Factor]);
  render(story());await login();await screen.findByText('Motorista QA');noFactors();
  expect(gateway.factors.get(i.operator)).toHaveLength(1);
 });
 it('requires login for a direct protected URL and rejects invalid credentials',async()=>{
  gateway.faults.rejectPassword=true;render(story('/'));await login();
  await waitFor(()=>expect(screen.getByRole('button',{name:'Entrar'})).toBeEnabled());
  expect((await gateway.client.auth.getSession()).data.session).toBeNull();
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect((await list()).error).not.toBeNull();noFactors();
 });
 it('does not grant another tenant or a driver financial access',async()=>{
  render(story());await login();await screen.findByText('Motorista QA');expect((await list(i.otherTenant)).error).not.toBeNull();
  await act(async()=>{await gateway.signIn(i.user);});await screen.findByText('Portal do motorista QA');
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect((await list()).error).not.toBeNull();noFactors();
 });
 it('removes access when the membership is revoked even with a valid password session',async()=>{
  render(story());await login();await screen.findByText('Motorista QA');await gateway.drain();
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await act(async()=>{await gateway.signIn();});await screen.findByText('Sem acesso a este tenant.');
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect((await list()).error).not.toBeNull();
 });
 it('clears private data and redirects to login on logout',async()=>{
  render(story());await login();await screen.findByText('Motorista QA');query.setQueryData(['private-marker'],'private');
  await act(async()=>{await gateway.client.auth.signOut({scope:'local'});});await screen.findByLabelText('Senha');
  expect(query.getQueryData(['private-marker'])).toBeUndefined();expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
 });
 it('restores an existing password session after reload without requiring Web Locks or MFA',async()=>{
  await gateway.signIn();locks.restore();render(story('/'));await screen.findByText('Motorista QA');cleanup();query.clear();
  const reloaded=gateway.newClient();mock.client=reloaded;render(story('/'));await screen.findByText('Motorista QA');
  noFactors();await reloaded.auth.stopAutoRefresh();
 });
});
