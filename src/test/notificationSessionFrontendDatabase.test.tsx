import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {act,cleanup,fireEvent,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import type {SupabaseClient} from '@supabase/supabase-js';
import {AuthProvider,useAuth} from '@/hooks/useAuth';
import {TenantProvider,useTenant} from '@/hooks/useTenant';
import {useToast} from '@/hooks/use-toast';
import {Toaster} from '@/components/ui/toaster';
import {Toaster as Sonner} from '@/components/ui/sonner';
import {useSonnerToast} from '@/hooks/useSonnerToast';
import {toast as rawSonner} from 'sonner';
import {GlobalAlert} from '@/components/GlobalAlert';
import {PrivilegedMfaGate} from '@/components/auth/PrivilegedMfaGate';
import {saveTenantSelection} from '@/lib/tenantMemberships';
import {cancelPendingAlert} from '@/hooks/useAlertStore';
import {sessionReadersDatabase} from './helpers/sessionReadersDatabase';
import {mfaSdkDatabaseGateway} from './helpers/mfaSdkDatabaseGateway';
import {manualSettlement} from './helpers/expenseCreationDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i} from './helpers/operationOutcomeDatabase';
import {installTestWebLocks} from './helpers/testWebLocks';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({client:null as SupabaseClient|null}));
vi.mock('@/integrations/supabase/client',()=>({get supabase(){return mock.client;}}));
function deferred(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
type Kind='shadcn'|'sonner-success'|'sonner-error';
let db:PGlite,query:QueryClient,gateway:ReturnType<typeof mfaSdkDatabaseGateway>,locks:ReturnType<typeof installTestWebLocks>;
let ready:ReturnType<typeof deferred>,response:ReturnType<typeof deferred>;
beforeAll(async()=>{({db}=await sessionReadersDatabase());},30000);
afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 locks=installTestWebLocks();localStorage.clear();await db.exec('begin');await manualSettlement(db);await expenseMfaRole(db,'operator');
 query=new QueryClient({defaultOptions:{queries:{retry:false}}});gateway=mfaSdkDatabaseGateway(db);mock.client=gateway.client;
 ready=deferred();response=deferred();await gateway.signIn();
});
afterEach(async()=>{response.resolve();cleanup();query.clear();cancelPendingAlert();rawSonner.getToasts().forEach(t=>rawSonner.dismiss(t.id));await gateway.drain();await gateway.client.auth.stopAutoRefresh();locks.restore();await db.exec('rollback');});
function Notices({kind}:{kind:Kind}){
 const sonnerToast=useSonnerToast();
 const {toast,dismiss}=useToast();const {user}=useAuth();const {currentTenant,setCurrentTenantId}=useTenant();
 const notify=(label:string)=>{const message=label+' — '+kind;if(kind==='shadcn')toast({title:message,duration:Infinity});else if(kind==='sonner-success')sonnerToast.success(message,{duration:Infinity});else sonnerToast.error(message,{description:'Resultado da consulta financeira QA.'});};
 const readThenNotify=async()=>{
  const result=await gateway.client.rpc('list_driver_settlements',{_tenant_id:currentTenant!.id});
  if(result.error)throw result.error;expect(result.data).toHaveProperty('total_count',1);ready.resolve();await response.promise;
  notify('Acerto privado da conta A');
 };
 return <><output aria-label="actor notice">{user?.id??'none'}</output><output aria-label="tenant notice">{currentTenant?.id??'none'}</output>
  <button onClick={()=>notify('Aviso privado da conta A')}>Avisar QA</button><button onClick={()=>void readThenNotify()}>Ler e avisar QA</button><button onClick={()=>dismiss()}>Limpar QA</button><button onClick={()=>setCurrentTenantId(i.otherTenant)}>Trocar empresa QA</button></>;
}
const story=(kind:Kind,mfa=false)=><QueryClientProvider client={query}><Toaster/><Sonner/><GlobalAlert/><AuthProvider><TenantProvider>{mfa?<PrivilegedMfaGate><Notices kind={kind}/></PrivilegedMfaGate>:<Notices kind={kind}/>}</TenantProvider></AuthProvider></QueryClientProvider>;
async function open(kind:Kind,mfa=false){render(story(kind,mfa));await waitFor(()=>expect(screen.getByLabelText('tenant notice')).toHaveTextContent(i.tenant));}
async function changeAccount(){await act(async()=>{await gateway.signIn(i.user);});await waitFor(()=>expect(screen.getByLabelText('actor notice')).toHaveTextContent(i.user));expect((await gateway.client.rpc('list_driver_settlements',{_tenant_id:i.tenant})).error?.message).toContain('forbidden');}
describe('notification privacy with actual session providers, SDK and financial SQL',()=>{
 it.each<Kind>(['shadcn','sonner-success','sonner-error'])('removes an existing %s notification before another account uses the page',async kind=>{
  await open(kind);fireEvent.click(screen.getByText('Avisar QA'));await screen.findAllByText('Aviso privado da conta A — '+kind);await changeAccount();
  expect(screen.queryAllByText('Aviso privado da conta A — '+kind)).toHaveLength(0);
 });
 it.each<Kind>(['shadcn','sonner-success','sonner-error'])('does not publish a late %s financial-read result into the replacement account',async kind=>{
  await open(kind);fireEvent.click(screen.getByText('Ler e avisar QA'));await act(async()=>{await ready.promise;});await changeAccount();
  await act(async()=>{response.resolve();await new Promise(resolve=>setTimeout(resolve,30));});
  expect(screen.queryAllByText('Acerto privado da conta A — '+kind)).toHaveLength(0);
 });
 it.each<Kind>(['shadcn','sonner-success','sonner-error'])('preserves a pending %s result through ordinary renewal of the same account and role',async kind=>{
  await open(kind);fireEvent.click(screen.getByText('Ler e avisar QA'));await act(async()=>{await ready.promise;});
  await act(async()=>{await gateway.signIn();});await act(async()=>{response.resolve();});
  await screen.findAllByText('Acerto privado da conta A — '+kind);expect((await gateway.client.rpc('list_driver_settlements',{_tenant_id:i.tenant})).data).toHaveProperty('total_count',1);
 });
 it.each<Kind>(['shadcn','sonner-success','sonner-error'])('discards a pending %s result on logout but preserves the durable command queue',async kind=>{
  await open(kind);localStorage.setItem('agvlog:qa-durable-command','pending QA');fireEvent.click(screen.getByText('Ler e avisar QA'));await act(async()=>{await ready.promise;});
  await act(async()=>{expect((await gateway.client.auth.signOut({scope:'local'})).error).toBeNull();});await waitFor(()=>expect(screen.getByLabelText('actor notice')).toHaveTextContent('none'));
  await act(async()=>{response.resolve();await new Promise(resolve=>setTimeout(resolve,30));});expect(screen.queryAllByText('Acerto privado da conta A — '+kind)).toHaveLength(0);
  expect((await gateway.client.rpc('list_driver_settlements',{_tenant_id:i.tenant})).error).not.toBeNull();expect(localStorage.getItem('agvlog:qa-durable-command')).toBe('pending QA');
 });
 it.each<Kind>(['shadcn','sonner-success','sonner-error'])('isolates a pending %s notice when the same operator selects another authorized tenant',async kind=>{
  await db.query("insert into public.tenant_memberships(user_id,tenant_id,role,active) values($1,$2,'operator',true)",[i.operator,i.otherTenant]);saveTenantSelection(i.operator,i.tenant);
  await open(kind);fireEvent.click(screen.getByText('Ler e avisar QA'));await act(async()=>{await ready.promise;});fireEvent.click(screen.getByText('Trocar empresa QA'));
  await waitFor(()=>expect(screen.getByLabelText('tenant notice')).toHaveTextContent(i.otherTenant));expect((await gateway.client.rpc('list_driver_settlements',{_tenant_id:i.otherTenant})).data).toHaveProperty('total_count',0);
  await act(async()=>{response.resolve();await new Promise(resolve=>setTimeout(resolve,30));});expect(screen.queryAllByText('Acerto privado da conta A — '+kind)).toHaveLength(0);
 });
 it.each<Kind>(['shadcn','sonner-success','sonner-error'])('clears visible and pending %s notices when the same owner loses MFA',async kind=>{
  await expenseMfaRole(db,'owner');await gateway.signIn(i.operator,'aal2');await open(kind,true);
  fireEvent.click(screen.getByText('Ler e avisar QA'));await act(async()=>{await ready.promise;});fireEvent.click(screen.getByText('Avisar QA'));await screen.findAllByText('Aviso privado da conta A — '+kind);
  await act(async()=>{await gateway.signIn(i.operator,'aal1');});await screen.findByText('Verificação em duas etapas');
  await act(async()=>{response.resolve();await new Promise(resolve=>setTimeout(resolve,30));});expect(screen.queryAllByText('Aviso privado da conta A — '+kind)).toHaveLength(0);expect(screen.queryAllByText('Acerto privado da conta A — '+kind)).toHaveLength(0);
  expect((await gateway.client.rpc('list_driver_settlements',{_tenant_id:i.tenant})).error?.message).toContain('forbidden');
 });
});
