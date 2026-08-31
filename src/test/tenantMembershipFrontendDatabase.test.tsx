import {afterAll,afterEach,beforeAll,beforeEach,describe,expect,it,vi} from 'vitest';
import {cleanup,render,screen,waitFor} from '@testing-library/react';
import {QueryClient,QueryClientProvider} from '@tanstack/react-query';
import type {PGlite} from '@electric-sql/pglite';
import {TenantProvider,useTenant} from '@/hooks/useTenant';
import {sessionReadersDatabase} from './helpers/sessionReadersDatabase';
import {adjustmentActor} from './helpers/settlementAdjustmentDatabase';
import {expenseMfaRole} from './helpers/expenseMfaDatabase';
import {operationIds as i,operationRpc} from './helpers/operationOutcomeDatabase';
vi.hoisted(async()=>{const {Blob,File}=await import('node:buffer');vi.stubGlobal('Blob',Blob);vi.stubGlobal('File',File);});
const mock=vi.hoisted(()=>({rpc:vi.fn(),actor:'',token:'initial',aal:'aal1',portalError:false}));
vi.mock('@/hooks/useAuth',()=>({useAuth:()=>({user:mock.actor?{id:mock.actor}:null,session:{access_token:mock.token},loading:false})}));
vi.mock('@/integrations/supabase/client',()=>({supabase:{rpc:mock.rpc}}));
let db:PGlite,client:QueryClient,transport:Promise<unknown>=Promise.resolve();
const portalUser='82000000-0000-4000-8000-000000000001';
beforeAll(async()=>{({db}=await sessionReadersDatabase());},30000);afterAll(async()=>{await db?.close();vi.unstubAllGlobals();});
beforeEach(async()=>{
 await db.exec('begin');mock.actor=i.operator;mock.aal='aal1';mock.token='initial';mock.portalError=false;mock.rpc.mockClear();localStorage.clear();
 client=new QueryClient({defaultOptions:{queries:{retry:false,staleTime:120000}}});
 mock.rpc.mockImplementation((name:string)=>{const actor=mock.actor,aal=mock.aal;let request:Promise<unknown>|undefined;return {abortSignal:()=>{
  if(!request){request=transport.then(async()=>{try{
   await adjustmentActor(db,actor,aal,{user_metadata:{role:'owner',aal:'aal2'}});
   if(!['get_current_memberships_v1','get_user_portal_tenants'].includes(name))throw new Error('Unexpected membership reader '+name);
   if(mock.portalError&&name==='get_user_portal_tenants')return {data:null,error:new Error('Portal unavailable QA')};
   return {data:(await operationRpc(db,'select * from '+name+'()')).rows,error:null};
  }catch(error){return {data:null,error};}});transport=request;}return request;
 }};});
});
afterEach(async()=>{cleanup();client.clear();await transport;await db.exec('rollback');localStorage.clear();});
function Probe(){const state=useTenant();return <><output aria-label="membership role">{state.currentRole??'none'}</output><output aria-label="membership tenant">{state.currentTenant?.id??'none'}</output><output aria-label="membership loading">{String(state.loading)}</output></>;}
const story=()=> <QueryClientProvider client={client}><TenantProvider><Probe/></TenantProvider></QueryClientProvider>;
async function portalAccess(){await db.query("insert into client_portal_access(tenant_id,user_id,client_id,access_type,active) values($1,$2,$3,'viewer',true)",[i.tenant,portalUser,i.client]);}
describe('actual tenant provider with current membership SQL',()=>{
 it('discovers only the signed-in membership and ignores user-editable authorization claims',async()=>{render(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('operator'));expect(screen.getByLabelText('membership tenant')).toHaveTextContent(i.tenant);expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['get_current_memberships_v1']);});
 it('retains privileged membership discovery for the real MFA enrollment gate',async()=>{await expenseMfaRole(db,'owner');render(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('owner'));await expect(operationRpc(db,'select list_driver_settlements($1)',[i.tenant])).rejects.toThrow('forbidden');});
 it('provides a client-only virtual membership from active portal access',async()=>{await portalAccess();mock.actor=portalUser;render(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('client'));expect(screen.getByLabelText('membership tenant')).toHaveTextContent(i.tenant);expect(mock.rpc.mock.calls.map(([name])=>name)).toEqual(['get_current_memberships_v1','get_user_portal_tenants']);});
 it('does not retain a revoked membership or data cached under its old role',async()=>{const view=render(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('operator'));client.setQueryData(['private-before-revocation'],'private QA');await db.query('update tenant_memberships set active=false where user_id=$1',[i.operator]);mock.token='after-revocation';view.rerender(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('none'));expect(client.getQueryData(['private-before-revocation'])).toBeUndefined();});
 it('resets data on a downgrade from operator to driver after token refresh',async()=>{const view=render(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('operator'));client.setQueryData(['privileged-list'],'private QA');await expenseMfaRole(db,'driver');mock.token='after-downgrade';view.rerender(story());await waitFor(()=>expect(screen.getByLabelText('membership role')).toHaveTextContent('driver'));expect(client.getQueryData(['privileged-list'])).toBeUndefined();});
 it('reports a portal read error rather than pretending the user has no memberships',async()=>{mock.actor=portalUser;mock.portalError=true;render(story());await screen.findByRole('alert');expect(screen.queryByLabelText('membership role')).not.toBeInTheDocument();});
 it('ignores inactive portal access and a saved tenant not in the result',async()=>{await portalAccess();await db.query('update client_portal_access set active=false where user_id=$1',[portalUser]);mock.actor=portalUser;localStorage.setItem('agvlog_tenant_id',i.otherTenant);render(story());await waitFor(()=>expect(screen.getByLabelText('membership loading')).toHaveTextContent('false'));expect(screen.getByLabelText('membership tenant')).toHaveTextContent('none');expect(screen.getByLabelText('membership role')).toHaveTextContent('none');});
});
