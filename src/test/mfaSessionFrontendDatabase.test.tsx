import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {SupabaseClient,Factor} from '@supabase/supabase-js';
import {AuthProvider,useAuth} from '@/hooks/useAuth';
import {TenantProvider,useTenant} from '@/hooks/useTenant';
import {PrivilegedMfaGate} from '@/components/auth/PrivilegedMfaGate';
import DriverSettlements from '@/pages/DriverSettlements';
import {sessionReadersDatabase} from './helpers/sessionReadersDatabase';
import {mfaSdkDatabaseGateway} from './helpers/mfaSdkDatabaseGateway';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {installTestWebLocks} from './helpers/testWebLocks';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({client:null as SupabaseClient|null}));
vi.mock('@/integrations/supabase/client',()=>({get supabase(){return mock.client;}}));
vi.mock('@/components/financial/DriverSettlementDrawer',()=>({default:()=>null}));
vi.mock('@/components/financial/NewManualSettlementDialog',()=>({default:()=>null}));
let db:PGlite,query:QueryClient,gateway:ReturnType<typeof mfaSdkDatabaseGateway>;
let locks:ReturnType<typeof installTestWebLocks>;
beforeAll(async()=>{({db}=await sessionReadersDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 locks=installTestWebLocks();
 await db.exec('begin');await manualSettlement(db);await expenseMfaRole(db,'owner');localStorage.clear();
 query=new QueryClient({defaultOptions:{queries:{retry:false}}});gateway=mfaSdkDatabaseGateway(db);mock.client=gateway.client;
 gateway.factors.set(i.operator,[{id:'factor-qa',factor_type:'totp',status:'verified',friendly_name:'AGVLog',created_at:new Date().toISOString(),updated_at:new Date().toISOString()} as Factor]);
 await gateway.signIn();
});
afterEach(async()=>{cleanup();query.clear();await gateway.client.auth.stopAutoRefresh();await gateway.drain();locks.restore();vi.useRealTimers();vi.restoreAllMocks();await db.exec('rollback');});
function Identity(){const {user,session}=useAuth();const {currentRole}=useTenant();return <><output aria-label="actor QA">{user?.id??'none'}</output><output aria-label="role QA">{currentRole??'none'}</output><output aria-label="expiry QA">{session?.expires_at??'missing'}</output></>;}
const story=()=> <QueryClientProvider client={query}><AuthProvider><TenantProvider><Identity/><PrivilegedMfaGate><DriverSettlements/></PrivilegedMfaGate></TenantProvider></AuthProvider></QueryClientProvider>;
async function verify(){fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código'}));}
const list=()=>gateway.client.rpc('list_driver_settlements',{_tenant_id:i.tenant});

describe('MFA with real providers, installed Auth SDK and actual business SQL',()=>{
 it('discovers an owner at AAL1 but blocks both the UI and direct database reader',async()=>{
  render(story());await screen.findByLabelText('Código de 6 dígitos');expect(screen.getByLabelText('role QA')).toHaveTextContent('owner');
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();const denied=await list();expect(denied.error?.message).toContain('forbidden');
  expect(gateway.requests.some(r=>r.path.includes('/factors/')&&r.method==='POST')).toBe(false);
 });
 it('promotes via the actual SDK event and opens the actual financial page only at AAL2',async()=>{
  const events:string[]=[];const {data:{subscription}}=gateway.client.auth.onAuthStateChange(event=>{events.push(event);});
  render(story());await verify();await screen.findByText('Motorista QA');expect(events).toContain('MFA_CHALLENGE_VERIFIED');
  expect((await list()).data).toHaveProperty('total_count',1);
  const reads=gateway.requests.filter(r=>r.path==='/rest/v1/rpc/list_driver_settlements');expect(reads.length).toBeGreaterThan(0);expect(reads.every(r=>r.aal==='aal2')).toBe(true);subscription.unsubscribe();
 });
 it('removes financial data and denies the database again after a same-user downgrade',async()=>{
  await gateway.signIn(i.operator,'aal2');render(story());await screen.findByText('Motorista QA');query.setQueryData(['private-marker'],'private');
  await act(async()=>{await gateway.signIn(i.operator,'aal1');});expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
  await screen.findByLabelText('Código de 6 dígitos');expect(query.getQueryData(['private-marker'])).toBeUndefined();expect((await list()).error?.message).toContain('forbidden');
 });
 it('does not impose MFA on an ordinary operator or grant a driver financial access',async()=>{
  await expenseMfaRole(db,'operator');render(story());await screen.findByText('Motorista QA');
  await act(async()=>{await gateway.signIn(i.user,'aal1');});expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
  await waitFor(()=>expect(screen.getByLabelText('role QA')).toHaveTextContent('driver'));expect((await list()).error?.message).toContain('forbidden');
  expect(gateway.requests.filter(r=>r.path.includes('/factors'))).toHaveLength(0);
 });
 it('removes a revoked privileged membership on session renewal even with AAL2',async()=>{
  await gateway.signIn(i.operator,'aal2');render(story());await screen.findByText('Motorista QA');await gateway.drain();
  await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);
  await act(async()=>{await gateway.signIn(i.operator,'aal2');});await waitFor(()=>expect(screen.getByLabelText('role QA')).toHaveTextContent('none'));
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect((await list()).error?.message).toContain('forbidden');
 });
 it('keeps invalid codes locked and supports an explicit read-and-retry flow',async()=>{
  gateway.faults.invalidCode=true;render(story());await verify();await screen.findByText(/Código inválido/);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
  expect((await list()).error?.message).toContain('forbidden');gateway.faults.invalidCode=false;fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));
  await verify();await screen.findByText('Motorista QA');
 });
 it('enrolls explicitly through the SDK and then validates the new factor and financial permissions',async()=>{
  gateway.factors.set(i.operator,[]);render(story());fireEvent.click(await screen.findByRole('button',{name:'Configurar autenticador'}));
  const image=await screen.findByAltText('QR code para configurar o autenticador');expect(image.getAttribute('src')).toMatch(/^data:image\/svg\+xml;/);
  expect(screen.getByLabelText('Chave manual do autenticador')).toHaveValue('SYNTHETIC_QA_SECRET');await verify();await screen.findByText('Motorista QA');
  expect(screen.queryByLabelText('Chave manual do autenticador')).not.toBeInTheDocument();expect(gateway.requests.filter(r=>r.path==='/auth/v1/factors'&&r.method==='POST')).toHaveLength(1);
 });
 it('denies AAL2 when Auth refuses server-side user validation',async()=>{
  await gateway.signIn(i.operator,'aal2');gateway.faults.denyUser=true;render(story());await screen.findByRole('button',{name:'Tentar novamente'});
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect(gateway.requests.some(r=>r.path==='/rest/v1/rpc/list_driver_settlements')).toBe(false);
 });
 it('serializes a delayed MFA response before a replacement account and retains the replacement in UI, SDK and storage',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});gateway.faults.beforeVerify=()=>held;
  render(story());await verify();await waitFor(()=>expect(gateway.requests.some(r=>r.path.endsWith('/verify'))).toBe(true));
  let replacementFinished=false;const replacement=gateway.signIn(i.user).then(()=>{replacementFinished=true;});
  await act(async()=>{});expect(replacementFinished).toBe(false);
  await act(async()=>{release();await replacement;});await waitFor(()=>expect(screen.getByLabelText('actor QA')).toHaveTextContent(i.user));
  expect((await gateway.client.auth.getSession()).data.session?.user.id).toBe(i.user);
  expect(JSON.parse(gateway.stored.get(gateway.storageKey)??'null').user.id).toBe(i.user);
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();expect((await list()).error?.message).toContain('forbidden');
 });
 it('serializes password login from another client sharing the session slot',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});gateway.faults.beforeVerify=()=>held;
  render(story());await verify();await waitFor(()=>expect(gateway.requests.some(r=>r.path.endsWith('/verify'))).toBe(true));
  const other=gateway.newClient();let finished=false;
  const login=other.auth.signInWithPassword({email:'driver@example.invalid',password:'synthetic-password'}).then(result=>{finished=true;return result;});
  await act(async()=>{});expect(finished).toBe(false);expect(gateway.requests.some(r=>r.path==='/auth/v1/token')).toBe(false);
  await act(async()=>{release();expect((await login).error).toBeNull();});
  expect((await other.auth.getSession()).data.session?.user.id).toBe(i.user);
  expect((await gateway.client.auth.getSession()).data.session?.user.id).toBe(i.user);
  await waitFor(()=>expect(screen.getByLabelText('actor QA')).toHaveTextContent(i.user));
  await other.auth.stopAutoRefresh();
 });
 it('serializes logout after an outstanding verification and never resurrects the session',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});gateway.faults.beforeVerify=()=>held;
  render(story());await verify();await waitFor(()=>expect(gateway.requests.some(r=>r.path.endsWith('/verify'))).toBe(true));
  let finished=false;const logout=gateway.client.auth.signOut({scope:'local'}).then(result=>{finished=true;return result;});
  await act(async()=>{});expect(finished).toBe(false);
  await act(async()=>{release();expect((await logout).error).toBeNull();});await waitFor(()=>expect(screen.getByLabelText('actor QA')).toHaveTextContent('none'));
  expect((await gateway.client.auth.getSession()).data.session).toBeNull();expect(gateway.stored.has(gateway.storageKey)).toBe(false);
  expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
 });
 it('keeps a replacement session of the same account at its own AAL1 after the old verification',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});gateway.faults.beforeVerify=()=>held;
  render(story());await verify();await waitFor(()=>expect(gateway.requests.some(r=>r.path.endsWith('/verify'))).toBe(true));
  const replacement=gateway.signIn(i.operator,'aal1');await act(async()=>{release();await replacement;});
  await screen.findByLabelText('Código de 6 dígitos');expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
  expect((await gateway.client.auth.mfa.getAuthenticatorAssuranceLevel()).data?.currentLevel).toBe('aal1');expect((await list()).error?.message).toContain('forbidden');
 });
 it('cannot clear a replacement session through a stale explicit-JWT user read',async()=>{
  const old=(await gateway.client.auth.getSession()).data.session!;await gateway.signIn(i.user);
  const before=gateway.requests.length;gateway.faults.denyUser=true;
  const result=await gateway.client.auth.getUser(old.access_token);expect(result.error?.code).toBe('auth_session_changed');
  expect(gateway.requests).toHaveLength(before);expect((await gateway.client.auth.getSession()).data.session?.user.id).toBe(i.user);
 });
 it('disables new AAL1 MFA without a browser-wide lock instead of using unsafe cross-tab fallback',async()=>{
  locks.restore();render(story());await screen.findByText(/Este navegador não permite coordenar/);
  expect(screen.queryByLabelText('Código de 6 dígitos')).not.toBeInTheDocument();expect(gateway.requests.some(r=>r.path.includes('/factors'))).toBe(false);
 });
 it('bounds a lost verify response, releases the actual SDK operation and ignores the late response after account replacement',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});gateway.faults.beforeVerify=()=>held;
  vi.spyOn(console,'error').mockImplementation(()=>{});render(story());await screen.findByLabelText('Código de 6 dígitos');
  vi.useFakeTimers();fireEvent.change(screen.getByLabelText('Código de 6 dígitos'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código'}));
  await act(async()=>{});expect(gateway.requests.some(r=>r.path.endsWith('/verify'))).toBe(true);
  const replacement=gateway.signIn(i.user);
  await act(async()=>{await vi.advanceTimersByTimeAsync(5100);await replacement;});vi.useRealTimers();
  await waitFor(()=>expect(screen.getByLabelText('actor QA')).toHaveTextContent(i.user));
  await act(async()=>{release();});expect((await gateway.client.auth.getSession()).data.session?.user.id).toBe(i.user);
  expect(JSON.parse(gateway.stored.get(gateway.storageKey)??'null').user.id).toBe(i.user);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
 });
 it('restores only the replacement account when providers and the SDK are recreated from persistent storage',async()=>{
  render(story());await verify();await screen.findByText('Motorista QA');await act(async()=>{await gateway.signIn(i.user);});
  await waitFor(()=>expect(screen.getByLabelText('actor QA')).toHaveTextContent(i.user));cleanup();query.clear();
  const reloaded=gateway.newClient();mock.client=reloaded;render(story());
  await waitFor(()=>expect(screen.getByLabelText('actor QA')).toHaveTextContent(i.user));await waitFor(()=>expect(screen.getByLabelText('role QA')).toHaveTextContent('driver'));
  expect((await reloaded.auth.getSession()).data.session?.user.id).toBe(i.user);expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();await reloaded.auth.stopAutoRefresh();
 });
 it('recovers the same account after a verification timeout and does not replace the recovered token with a late one',async()=>{
  let release!:()=>void;const held=new Promise<void>(resolve=>{release=resolve;});gateway.faults.beforeVerify=()=>held;
  vi.spyOn(console,'error').mockImplementation(()=>{});render(story());await screen.findByLabelText('Código de 6 dígitos');
  vi.useFakeTimers();fireEvent.change(screen.getByLabelText('Código de 6 dígitos'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(5100);});vi.useRealTimers();expect(screen.queryByText('Motorista QA')).not.toBeInTheDocument();
  gateway.faults.beforeVerify=undefined;fireEvent.click(await screen.findByRole('button',{name:'Tentar novamente'}));await verify();await screen.findByText('Motorista QA');
  const recovered=(await gateway.client.auth.getSession()).data.session!.access_token;await act(async()=>{release();});
  expect((await gateway.client.auth.getSession()).data.session?.access_token).toBe(recovered);expect((await list()).data).toHaveProperty('total_count',1);
 });
});
