import {afterEach,beforeEach,describe,expect,it,vi} from 'vitest';
import {StrictMode} from 'react';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import {PrivilegedMfaGate} from '@/components/auth/PrivilegedMfaGate';
import {confirmAction,useAlertStore} from '@/hooks/useAlertStore';
const mock=vi.hoisted(()=>({actor:'actor-a',tenant:'tenant-a',role:'owner',token:'token-a',expires:0,level:'aal2',assurance:vi.fn(),getUser:vi.fn(),getSession:vi.fn(),listFactors:vi.fn(),enroll:vi.fn(),challenge:vi.fn(),verify:vi.fn(),unenroll:vi.fn(),signOut:vi.fn()}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.actor?{id:mock.actor,email:'qa@example.invalid'}:null,session:mock.token?{user:{id:mock.actor},access_token:mock.token,expires_at:mock.expires}:null,signOut:mock.signOut})}));
vi.mock('@/hooks/useTenant',()=>({useTenant:()=>({currentTenant:mock.tenant?{id:mock.tenant}:null,currentRole:mock.role})}));
vi.mock('@/lib/auth/authSessionCoordination',()=>({hasSharedAuthLock:()=>true}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{auth:{getUser:mock.getUser,getSession:mock.getSession,mfa:{getAuthenticatorAssuranceLevel:mock.assurance,listFactors:mock.listFactors,enroll:mock.enroll,challenge:mock.challenge,verify:mock.verify,unenroll:mock.unenroll}}}}));
let client:QueryClient;
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>{resolve=r;});return {promise,resolve};}
const factor=(status='verified')=>({id:'factor-a',status,factor_type:'totp',friendly_name:'AGVLog',created_at:'2026-08-30T00:00:00Z',updated_at:'2026-08-30T00:00:00Z'});
const assurance=(level:string)=>({data:{currentLevel:level,nextLevel:'aal2',currentAuthenticationMethods:[]},error:null});
const story=()=> <QueryClientProvider client={client}><PrivilegedMfaGate><p>Privileged QA</p></PrivilegedMfaGate></QueryClientProvider>;
beforeEach(()=>{vi.resetAllMocks();mock.actor='actor-a';mock.tenant='tenant-a';mock.role='owner';mock.token='token-a';mock.level='aal2';mock.expires=Math.floor(Date.now()/1000)+3600;
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});mock.assurance.mockImplementation(async()=>assurance(mock.level));mock.getUser.mockImplementation(async()=>({data:{user:{id:mock.actor,factors:[factor()]}},error:null}));mock.getSession.mockImplementation(async()=>({data:{session:{user:{id:mock.actor},access_token:mock.token,expires_at:mock.expires}},error:null}));mock.listFactors.mockResolvedValue({data:{all:[factor()],totp:[factor()],phone:[]},error:null});mock.enroll.mockResolvedValue({data:{id:'new-factor',type:'totp',totp:{qr_code:'data:image/svg+xml;utf-8,<svg/>',secret:'SYNTHETIC_QA_SECRET',uri:'otpauth://totp/QA'}},error:null});mock.challenge.mockResolvedValue({data:{id:'challenge-a',type:'totp'},error:null});mock.verify.mockResolvedValue({data:{user:{id:mock.actor},access_token:'verified-token',refresh_token:'synthetic'},error:null});mock.unenroll.mockResolvedValue({data:{id:'factor-a'},error:null});
});
afterEach(()=>{cleanup();client.clear();useAlertStore.getState().onCancel?.();useAlertStore.getState().hideAlert();vi.useRealTimers();vi.restoreAllMocks();});
function setFactors(factors:ReturnType<typeof factor>[]){mock.getUser.mockImplementation(async()=>({data:{user:{id:mock.actor,factors}},error:null}));}
async function submitCode(){fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código'}));}
describe('privileged MFA session lifecycle',()=>{
 it.each(['owner','admin'])('permits an AAL2 %s and does not impose MFA on a normal operator',async role=>{mock.role=role;const view=render(story());await screen.findByText('Privileged QA');view.unmount();mock.role='operator';mock.assurance.mockClear();render(story());expect(screen.getByText('Privileged QA')).toBeInTheDocument();expect(mock.assurance).not.toHaveBeenCalled();});
 it('closes immediately after token downgrade and removes cached data and unsubmitted confirmation',async()=>{const view=render(story());await screen.findByText('Privileged QA');client.setQueryData(['private-list'],'private');let pending!:Promise<boolean>;act(()=>{pending=confirmAction('Private action');});mock.level='aal1';mock.token='downgraded';view.rerender(story());expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();await screen.findByLabelText('Código de 6 dígitos');expect(client.getQueryData(['private-list'])).toBeUndefined();await expect(pending).resolves.toBe(false);});
 it('does not reuse a ready result after changing account',async()=>{const view=render(story());await screen.findByText('Privileged QA');mock.actor='actor-b';mock.token='token-b';mock.level='aal1';view.rerender(story());expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();await screen.findByLabelText('Código de 6 dígitos');});
 it('ignores a late AAL2 result for the previous token',async()=>{const old=deferred<ReturnType<typeof assurance>>();mock.assurance.mockReturnValueOnce(old.promise);const view=render(story());await waitFor(()=>expect(mock.assurance).toHaveBeenCalledWith('token-a'));mock.token='next-token';mock.level='aal1';view.rerender(story());await act(async()=>old.resolve(assurance('aal2')));await screen.findByLabelText('Código de 6 dígitos');expect(mock.assurance).toHaveBeenCalledWith('next-token');expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();});
 it('never unlocks solely because verify returns success without a current AAL2 session',async()=>{mock.level='aal1';render(story());fireEvent.change(await screen.findByLabelText('Código de 6 dígitos'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código'}));await waitFor(()=>expect(mock.verify).toHaveBeenCalled());expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();});
 it('does not create factors during render or retrying a read',async()=>{mock.level='aal1';mock.listFactors.mockResolvedValue({data:{all:[],totp:[],phone:[]},error:null});mock.getUser.mockImplementation(async()=>({data:{user:{id:mock.actor,factors:[]}},error:null}));render(story());await screen.findByRole('button',{name:'Configurar autenticador'});expect(mock.enroll).not.toHaveBeenCalled();});
 it('does not admit a missing or expired privileged session',async()=>{mock.expires=Math.floor(Date.now()/1000)-1;render(story());await act(async()=>{});expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();expect(mock.enroll).not.toHaveBeenCalled();});
 it('bounds an assurance read that never responds',async()=>{vi.useFakeTimers();mock.assurance.mockReturnValue(new Promise(()=>{}));render(story());await act(async()=>{await vi.advanceTimersByTimeAsync(8100);});expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeInTheDocument();expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();});
 it('unlocks only after the promoted session is delivered and revalidated',async()=>{
  mock.level='aal1';const view=render(story());
  mock.verify.mockImplementation(async()=>{mock.token='promoted';mock.level='aal2';view.rerender(story());return {data:{user:{id:mock.actor},access_token:mock.token},error:null};});
  await submitCode();await screen.findByText('Privileged QA');
  expect(mock.assurance).toHaveBeenCalledWith('promoted');expect(mock.getUser).toHaveBeenCalledWith('promoted');
 });
 it('rejects an AAL2 read belonging to another actor',async()=>{
  mock.getUser.mockResolvedValue({data:{user:{id:'other-actor',factors:[factor()]}},error:null});render(story());
  await screen.findByText(/A resposta não corresponde à conta atual/);expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();
 });
 it('rejects a verification response for another actor',async()=>{
  mock.level='aal1';mock.verify.mockResolvedValue({data:{user:{id:'other-actor'}},error:null});render(story());await submitCode();
  await screen.findByText('A confirmação não corresponde à conta atual.');expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();
 });
 it('does not verify a late challenge after switching accounts',async()=>{
  mock.level='aal1';const pending=deferred<{data:{id:string;type:string};error:null}>();mock.challenge.mockReturnValueOnce(pending.promise);
  const view=render(story());await submitCode();await waitFor(()=>expect(mock.challenge).toHaveBeenCalledTimes(1));
  mock.actor='actor-b';mock.token='token-b';view.rerender(story());
  await act(async()=>pending.resolve({data:{id:'old-challenge',type:'totp'},error:null}));
  await screen.findByLabelText('Código de 6 dígitos');expect(mock.verify).not.toHaveBeenCalled();
 });
 it('locks an already authorized view at session expiry without a token event',async()=>{
  vi.useFakeTimers();mock.expires=Math.floor(Date.now()/1000)+2;render(story());await act(async()=>{});
  expect(screen.getByText('Privileged QA')).toBeInTheDocument();client.setQueryData(['private-expiring'],'private');
  await act(async()=>{await vi.advanceTimersByTimeAsync(2100);});
  expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();expect(client.getQueryData(['private-expiring'])).toBeUndefined();
 });
 it('checks expiry before the next write even if the browser expiry timer has not run',async()=>{
  vi.useFakeTimers();mock.level='aal1';const pending=deferred<{data:{id:string;type:string};error:null}>();mock.challenge.mockReturnValueOnce(pending.promise);
  render(story());await act(async()=>{});fireEvent.change(screen.getByLabelText('Código de 6 dígitos'),{target:{value:'123456'}});fireEvent.click(screen.getByRole('button',{name:'Confirmar código'}));
  await act(async()=>{});expect(mock.challenge).toHaveBeenCalledTimes(1);vi.setSystemTime((mock.expires+1)*1000);
  await act(async()=>pending.resolve({data:{id:'old-challenge',type:'totp'},error:null}));
  expect(mock.verify).not.toHaveBeenCalled();expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();
 });
 it.each(['actor','tenant','role','token'] as const)('keeps a missing %s blocked',async field=>{
  mock[field]='';render(story());await act(async()=>{});expect(screen.queryByText('Privileged QA')).not.toBeInTheDocument();expect(mock.enroll).not.toHaveBeenCalled();
 });
 it('does not enroll automatically under StrictMode or remount',async()=>{
  mock.level='aal1';setFactors([]);const view=render(<StrictMode>{story()}</StrictMode>);
  await screen.findByRole('button',{name:'Configurar autenticador'});view.unmount();render(story());
  await screen.findByRole('button',{name:'Configurar autenticador'});expect(mock.enroll).not.toHaveBeenCalled();
 });
 it('creates one explicitly requested factor with a stable name and keeps its secret out of persistence',async()=>{
  mock.level='aal1';setFactors([]);localStorage.clear();sessionStorage.clear();localStorage.setItem('qa-durable-outbox','preserve');
  const view=render(story());const start=await screen.findByRole('button',{name:'Configurar autenticador'});fireEvent.click(start);fireEvent.click(start);
  const secret=await screen.findByLabelText('Chave manual do autenticador');expect(secret).toHaveAttribute('type','password');expect(secret).toHaveValue('SYNTHETIC_QA_SECRET');
  expect(mock.enroll).toHaveBeenCalledTimes(1);expect(mock.enroll).toHaveBeenCalledWith({factorType:'totp',friendlyName:'AGVLog'});
  fireEvent.click(screen.getByRole('button',{name:'Mostrar chave manual'}));expect(secret).toHaveAttribute('type','text');
  expect(JSON.stringify(localStorage)).not.toContain('SYNTHETIC_QA_SECRET');expect(JSON.stringify(sessionStorage)).not.toContain('SYNTHETIC_QA_SECRET');
  expect(client.getQueryCache().getAll()).toEqual([]);expect(localStorage.getItem('qa-durable-outbox')).toBe('preserve');
  view.unmount();setFactors([{...factor('unverified'),id:'new-factor'}]);render(story());await screen.findByLabelText('Código de 6 dígitos');
  expect(screen.queryByLabelText('Chave manual do autenticador')).not.toBeInTheDocument();expect(mock.enroll).toHaveBeenCalledTimes(1);
 });
 it('reconciles an enrollment whose response was lost without creating another factor',async()=>{
  vi.useFakeTimers();mock.level='aal1';setFactors([]);const pending=deferred<unknown>();
  mock.enroll.mockImplementation(()=>{setFactors([{...factor('unverified'),id:'new-factor'}]);return pending.promise;});
  render(story());await act(async()=>{});fireEvent.click(screen.getByRole('button',{name:'Configurar autenticador'}));
  await act(async()=>{await vi.advanceTimersByTimeAsync(8100);});expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await act(async()=>{});
  expect(screen.getByLabelText('Código de 6 dígitos')).toBeInTheDocument();expect(mock.enroll).toHaveBeenCalledTimes(1);
  await act(async()=>pending.resolve({data:{id:'new-factor',type:'totp',totp:{secret:'LATE_SECRET',qr_code:'data:image/svg+xml;utf-8,<svg/>'}},error:null}));
  expect(screen.queryByLabelText('Chave manual do autenticador')).not.toBeInTheDocument();
 });
 it('discards only an incomplete app factor after explicit confirmation',async()=>{
  mock.level='aal1';setFactors([factor('unverified')]);mock.unenroll.mockImplementation(async()=>{setFactors([]);return {data:{id:'factor-a'},error:null};});
  render(story());fireEvent.click(await screen.findByRole('button',{name:'Descartar configuração incompleta'}));expect(mock.unenroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Manter configuração'}));expect(mock.unenroll).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button',{name:'Descartar configuração incompleta'}));fireEvent.click(screen.getByRole('button',{name:'Confirmar descarte da configuração'}));
  await screen.findByRole('button',{name:'Configurar autenticador'});expect(mock.unenroll).toHaveBeenCalledExactlyOnceWith({factorId:'factor-a'});
 });
 it('refuses to discard a factor that became verified after the confirmation opened',async()=>{
  mock.level='aal1';setFactors([factor('unverified')]);render(story());fireEvent.click(await screen.findByRole('button',{name:'Descartar configuração incompleta'}));
  setFactors([factor()]);fireEvent.click(screen.getByRole('button',{name:'Confirmar descarte da configuração'}));
  await screen.findByText(/Somente uma configuração AGVLog ainda não verificada/);expect(mock.unenroll).not.toHaveBeenCalled();
 });
 it('offers only verified factors when one exists and clears the code on selection',async()=>{
  mock.level='aal1';setFactors([factor(),{...factor(),id:'factor-b',friendly_name:'Segundo'}, {...factor('unverified'),id:'incomplete'}]);render(story());
  const code=await screen.findByLabelText('Código de 6 dígitos');fireEvent.change(code,{target:{value:'12A34-56'}});expect(code).toHaveValue('123456');
  expect(screen.getAllByRole('option')).toHaveLength(2);fireEvent.change(screen.getByLabelText('Autenticador'),{target:{value:'factor-b'}});
  expect(screen.getByLabelText('Código de 6 dígitos')).toHaveValue('');await submitCode();
  await waitFor(()=>expect(mock.challenge).toHaveBeenCalledWith({factorId:'factor-b'}));expect(screen.queryByRole('button',{name:'Descartar configuração incompleta'})).not.toBeInTheDocument();
 });
 it('preserves an incomplete factor from another app',async()=>{
  mock.level='aal1';setFactors([{...factor('unverified'),friendly_name:'Other app'}]);render(story());await screen.findByLabelText('Código de 6 dígitos');
  expect(screen.queryByRole('button',{name:'Descartar configuração incompleta'})).not.toBeInTheDocument();expect(mock.unenroll).not.toHaveBeenCalled();
  expect(screen.getByRole('button',{name:'Configurar autenticador AGVLog'})).toBeInTheDocument();
 });
 it('refuses enrollment if the SDK session no longer matches the displayed account',async()=>{
  mock.level='aal1';setFactors([]);mock.getSession.mockResolvedValue({data:{session:{user:{id:'different'},access_token:'different'}},error:null});
  render(story());fireEvent.click(await screen.findByRole('button',{name:'Configurar autenticador'}));await screen.findByText(/A sessão mudou/);expect(mock.enroll).not.toHaveBeenCalled();
 });
 it('does not expose arbitrary SDK errors or continue after an unmount',async()=>{
  mock.assurance.mockResolvedValueOnce({data:null,error:{message:'PRIVATE_ERROR_PAYLOAD'}});const view=render(story());await screen.findByRole('button',{name:'Tentar novamente'});
  expect(screen.queryByText(/PRIVATE_ERROR_PAYLOAD/)).not.toBeInTheDocument();const pending=deferred<ReturnType<typeof assurance>>();mock.assurance.mockReturnValueOnce(pending.promise);
  fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(mock.assurance).toHaveBeenCalledTimes(2));const calls=mock.getUser.mock.calls.length;view.unmount();
  await act(async()=>pending.resolve(assurance('aal2')));expect(mock.getUser).toHaveBeenCalledTimes(calls);
 });
});
