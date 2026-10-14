import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { TenantProvider, useTenant } from '@/hooks/useTenant';
import { clearActiveTenantId, getActiveTenantId, setActiveTenantId } from '@/lib/tenant/activeTenantContext';

// Actual providers; controlled SDK transport. These JWTs are synthetic fixtures,
// not proof of Supabase Auth verification or native browser authorization.
const sdk = vi.hoisted(() => ({
  listeners: new Set<(event: AuthChangeEvent, session: Session | null) => void>(),
  getSession: vi.fn(), getUser: vi.fn(), signOut: vi.fn(), refreshSession: vi.fn(),
  rpc: vi.fn(), removeAllChannels: vi.fn(), toast: vi.fn(),
}));
vi.mock('@/integrations/supabase/client', () => ({ supabase: {
  auth: {
    getSession: sdk.getSession, getUser: sdk.getUser, signOut: sdk.signOut,
    refreshSession: sdk.refreshSession,
    onAuthStateChange: (listener: (event: AuthChangeEvent, session: Session | null) => void) => {
      sdk.listeners.add(listener);
      return { data: { subscription: { unsubscribe: () => sdk.listeners.delete(listener) } } };
    },
  },
  rpc: sdk.rpc, removeAllChannels: sdk.removeAllChannels,
} }));
vi.mock('@/hooks/use-toast', () => ({ useToast: () => ({ toast: sdk.toast }) }));

const actorA = 'a6000000-0000-4000-8000-000000000001';
const actorB = 'a6000000-0000-4000-8000-000000000002';
const tenantA = 'a6000000-0000-4000-8000-000000000011';
const tenantB = 'a6000000-0000-4000-8000-000000000012';
const tenantC = 'a6000000-0000-4000-8000-000000000013';
type RefreshReply = { data: { session: Session | null }; error: Error | null };
type MembershipRow = ReturnType<typeof membership>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function membership(tenant: string, role = 'operator') {
  return { tenant_id: tenant, tenant_name: tenant, role, plan_key: 'qa', timezone: 'America/Sao_Paulo' };
}
function session(actor: string, tenant: string, nonce = 'initial'): Session {
  const encoded = btoa(JSON.stringify({ sub: actor, active_tenant_id: tenant, nonce }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { user: { id: actor }, access_token: `eyJhbGciOiJIUzI1NiJ9.${encoded}.synthetic`,
    refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer' } as Session;
}
function refreshReply(value: Session | null): RefreshReply { return { data: { session: value }, error: null }; }
function rpcReply(data: unknown, error: Error | null = null) {
  const promise = Promise.resolve({ data, error });
  return Object.assign(promise, { abortSignal: () => promise });
}
let client: QueryClient, current: Session | null;
let rows: Record<string, MembershipRow[]>;
let activation: Promise<boolean> | null;
async function emit(value: Session | null, event: AuthChangeEvent = value ? 'SIGNED_IN' : 'SIGNED_OUT') {
  current = value;
  await act(async () => { sdk.listeners.forEach(listener => listener(event, value)); });
}
function startedActivation() {
  if (!activation) throw new Error('The explicit activation did not start');
  return activation;
}
function activationCalls() { return sdk.rpc.mock.calls.filter(([name]) => name === 'set_active_tenant_context_v1'); }
function Identity() { const { user,session:authSession } = useAuth(); return <><output aria-label="current actor">{user?.id ?? 'none'}</output><output aria-label="current claim">{authSession?JSON.parse(atob(authSession.access_token.split('.')[1])).active_tenant_id:'none'}</output></>; }
function Probe() {
  const tenant = useTenant();
  return <><output aria-label="current tenant">{tenant.currentTenant?.id ?? 'none'}</output>
    <output aria-label="current role">{tenant.currentRole ?? 'none'}</output>
    <button onClick={() => { activation = tenant.activateTenantId(tenantB); }}>Activate target tenant</button></>;
}
function Story() {
  return <QueryClientProvider client={client}><AuthProvider><Identity/>
    <TenantProvider><Probe/></TenantProvider></AuthProvider></QueryClientProvider>;
}
async function readyA() {
  await emit(session(actorA, tenantA));
  await waitFor(() => expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantA));
  expect(getActiveTenantId()).toBe(tenantA);
}
async function readyB() {
  await emit(session(actorB, tenantC));
  await waitFor(() => expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantC));
  expect(getActiveTenantId()).toBe(tenantC);
}
beforeEach(() => {
  vi.resetAllMocks(); sdk.listeners.clear(); localStorage.clear(); clearActiveTenantId();
  vi.spyOn(Navigator.prototype, 'onLine', 'get').mockReturnValue(true);
  current = null; activation = null;
  rows = { [actorA]: [membership(tenantA), membership(tenantB)], [actorB]: [membership(tenantC, 'driver')] };
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  sdk.getSession.mockResolvedValue(refreshReply(null));
  sdk.getUser.mockImplementation(async () => ({ data: { user: current?.user ?? null }, error: null }));
  sdk.signOut.mockImplementation(async () => { await emit(null); return { error: null }; });
  sdk.refreshSession.mockImplementation(async () => refreshReply(current));
  sdk.removeAllChannels.mockResolvedValue([]);
  sdk.rpc.mockImplementation((name: string) => {
    if (name === 'get_current_memberships_v1') return rpcReply(rows[current?.user.id ?? ''] ?? []);
    if (name === 'get_user_portal_tenants') return rpcReply([]);
    if (name === 'set_active_tenant_context_v1') return rpcReply(null);
    throw new Error(`Unexpected RPC ${name}`);
  });
});
afterEach(() => { vi.useRealTimers(); cleanup(); client.clear(); sdk.listeners.clear(); clearActiveTenantId(); vi.restoreAllMocks(); });


async function openReady(){render(<StrictMode><Story/></StrictMode>);await readyA();}
async function advance(ms:number){await act(async()=>{await vi.advanceTimersByTimeAsync(ms);});}
async function expire(){await advance(10001);vi.useRealTimers();expect(await screen.findByRole('alert')).toHaveTextContent('demorou mais que o esperado');expect(screen.queryByLabelText('current tenant')).toBeNull();expect(getActiveTenantId()).toBeNull();}
function holdActivation(){const held=deferred<{data:null;error:null}>();const abort=vi.fn();const request=Object.assign(held.promise,{abortSignal:(signal:AbortSignal)=>{signal.addEventListener('abort',abort);return held.promise;}});sdk.rpc.mockImplementation((name:string)=>name==='set_active_tenant_context_v1'?request:rpcReply(rows[current?.user.id??'']??[]));return {held,abort};}
async function startPassive(){await openReady();const held=holdActivation();vi.useFakeTimers();await emit(session(actorA,tenantC,'missing-local-claim'));await advance(5);expect(activationCalls()).toHaveLength(1);return held;}
async function late(held:ReturnType<typeof holdActivation>['held']){await act(async()=>{held.resolve({data:null,error:null});await held.promise;});}
function successfulSwitch(){sdk.rpc.mockImplementation((name:string,args:{_tenant_id?:string})=>{if(name==='set_active_tenant_context_v1'){current=session(actorA,args._tenant_id!,'rpc-committed');return rpcReply(null);}return rpcReply(rows[current?.user.id??'']??[]);});sdk.refreshSession.mockImplementation(async()=>{const next=current; sdk.listeners.forEach(listener=>listener('TOKEN_REFRESHED',next));return refreshReply(next);});}

describe('tenant activation deadline and explicit recovery',()=>{
 it('bounds passive activation even if transport ignores abort and preserves failure after late completion',async()=>{
  const {held,abort}=await startPassive();await expire();expect(abort).toHaveBeenCalledTimes(1);expect(screen.getByRole('button',{name:'Tentar novamente'})).toBeEnabled();expect(screen.getByRole('button',{name:'Sair'})).toBeEnabled();await late(held);expect(sdk.refreshSession).not.toHaveBeenCalled();expect(screen.getByRole('alert')).toBeVisible();expect(getActiveTenantId()).toBeNull();
 });
 it('retries after timeout, confirms the signed scope, and ignores the older RPC later',async()=>{
  const {held}=await startPassive();await expire();successfulSwitch();fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantA));expect(getActiveTenantId()).toBe(tenantA);const calls=sdk.refreshSession.mock.calls.length;await late(held);expect(sdk.refreshSession).toHaveBeenCalledTimes(calls);expect(getActiveTenantId()).toBe(tenantA);expect(screen.queryByRole('alert')).toBeNull();
 });
 it('lets the user cancel the wait without granting access or allowing late completion',async()=>{
  const {held,abort}=await startPassive();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));vi.useRealTimers();expect(await screen.findByRole('alert')).toHaveTextContent('cancelada');expect(abort).toHaveBeenCalledTimes(1);expect(getActiveTenantId()).toBeNull();await late(held);expect(sdk.refreshSession).not.toHaveBeenCalled();expect(screen.queryByLabelText('current tenant')).toBeNull();
 });
 it('allows explicit retry after cancellation',async()=>{
  const {held}=await startPassive();fireEvent.click(screen.getByRole('button',{name:'Cancelar'}));vi.useRealTimers();expect(await screen.findByRole('alert')).toHaveTextContent('cancelada');successfulSwitch();fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantA));await late(held);expect(getActiveTenantId()).toBe(tenantA);
 });
 it('signs out while pending and allows a new actor to enter without an old RPC restoring scope',async()=>{
  const {held}=await startPassive();fireEvent.click(screen.getByRole('button',{name:'Sair'}));await advance(5);vi.useRealTimers();await waitFor(()=>expect(screen.getByLabelText('current actor')).toHaveTextContent('none'));expect(sdk.signOut).toHaveBeenCalledTimes(1);await readyB();await late(held);expect(screen.getByLabelText('current actor')).toHaveTextContent(actorB);expect(getActiveTenantId()).toBe(tenantC);expect(sdk.refreshSession).not.toHaveBeenCalled();
 });
 it('retains the blocking screen when sign-out fails instead of clearing the session optimistically',async()=>{
  await startPassive();sdk.signOut.mockResolvedValueOnce({error:new Error('synthetic signout failure')});fireEvent.click(screen.getByRole('button',{name:'Sair'}));await advance(5);vi.useRealTimers();expect(await screen.findByRole('alert')).toHaveTextContent('cancelada');expect(screen.getByLabelText('current actor')).toHaveTextContent(actorA);expect(sdk.toast).toHaveBeenCalled();expect(screen.queryByLabelText('current tenant')).toBeNull();
 });
 it('bounds passive token renewal and does not auto-open on its late TOKEN_REFRESHED event',async()=>{
  await openReady();const held=deferred<RefreshReply>();sdk.refreshSession.mockImplementationOnce(()=>held.promise);vi.useFakeTimers();await emit(session(actorA,tenantC,'missing-claim'));await advance(5);expect(sdk.refreshSession).toHaveBeenCalledTimes(1);await expire();const valid=session(actorA,tenantA,'late-signed');await emit(valid,'TOKEN_REFRESHED');await act(async()=>{held.resolve(refreshReply(valid));await held.promise;});expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByLabelText('current tenant')).toBeNull();expect(getActiveTenantId()).toBeNull();
 });
 it.each(['validation','activation','renewal','rollback'])('bounds the entire explicit switch when %s never settles',async phase=>{
  await openReady();const refreshHold=deferred<RefreshReply>(),rpcHold=deferred<{data:null;error:null}>();let targetActivated=false;
  sdk.rpc.mockImplementation((name:string,args:{_tenant_id?:string})=>{if(name!=='set_active_tenant_context_v1')return rpcReply(rows[current?.user.id??'']??[]);if(phase==='activation'||(phase==='rollback'&&args._tenant_id===tenantA))return rpcHold.promise;targetActivated=true;return rpcReply(null);});
  sdk.refreshSession.mockImplementation(async()=>{if(phase==='validation'||(phase==='renewal'&&targetActivated))return refreshHold.promise;if(phase==='rollback'&&targetActivated)return {data:{session:null},error:new Error('synthetic renewal rejected')};return refreshReply(current);});
  vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Activate target tenant'}));await advance(5);await expire();await expect(startedActivation()).resolves.toBe(false);const calls=activationCalls().length;await act(async()=>{rpcHold.resolve({data:null,error:null});refreshHold.resolve(refreshReply(session(actorA,tenantB,'late')));await Promise.resolve();});expect(activationCalls()).toHaveLength(calls);expect(getActiveTenantId()).toBeNull();expect(screen.getByRole('alert')).toBeVisible();
 });
 it('cancels explicit activation on authoritative context change and ignores the late result',async()=>{
  await openReady();const {held,abort}=holdActivation();fireEvent.click(screen.getByRole('button',{name:'Activate target tenant'}));await waitFor(()=>expect(activationCalls()).toHaveLength(1));await emit(session(actorA,tenantA,'changed-role'),'TOKEN_REFRESHED');rows[actorA]=[membership(tenantA,'driver'),membership(tenantB,'driver')];await act(async()=>{await client.refetchQueries({queryKey:['current-tenant-memberships',actorA]});});await waitFor(()=>expect(screen.getByLabelText('current role')).toHaveTextContent('driver'));expect(abort).toHaveBeenCalledTimes(1);await expect(startedActivation()).resolves.toBe(false);await late(held);expect(getActiveTenantId()).toBe(tenantA);expect(screen.getByLabelText('current role')).toHaveTextContent('driver');
 });
 it('uses one total deadline instead of restarting the budget for each step',async()=>{
  await openReady();const held=deferred<RefreshReply>();sdk.refreshSession.mockImplementationOnce(()=>held.promise);sdk.rpc.mockImplementation((name:string)=>name==='set_active_tenant_context_v1'?new Promise(()=>{}):rpcReply(rows[actorA]));
  vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Activate target tenant'}));await advance(9000);expect(screen.getByText('Confirmando empresa ativa.')).toBeVisible();await act(async()=>{held.resolve(refreshReply(current));await held.promise;});await advance(5);expect(activationCalls()).toHaveLength(1);await advance(1001);vi.useRealTimers();expect(await screen.findByRole('alert')).toHaveTextContent('demorou mais que o esperado');await expect(startedActivation()).resolves.toBe(false);expect(getActiveTenantId()).toBeNull();
 });
 it('requires explicit recovery after a late signed target event from an expired switch',async()=>{
  await openReady();const held=deferred<RefreshReply>();sdk.refreshSession.mockResolvedValueOnce(refreshReply(current)).mockImplementationOnce(()=>held.promise);vi.useFakeTimers();fireEvent.click(screen.getByRole('button',{name:'Activate target tenant'}));await advance(5);expect(sdk.refreshSession).toHaveBeenCalledTimes(2);await expire();await expect(startedActivation()).resolves.toBe(false);
  const target=session(actorA,tenantB,'late-target');await emit(target,'TOKEN_REFRESHED');await act(async()=>{held.resolve(refreshReply(target));await held.promise;});expect(screen.getByRole('alert')).toBeVisible();expect(screen.queryByLabelText('current tenant')).toBeNull();expect(getActiveTenantId()).toBeNull();
  successfulSwitch();fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantB));expect(getActiveTenantId()).toBe(tenantB);
 });
 it('keeps timeout recovery blocked through membership failure and revalidation',async()=>{
  const {held}=await startPassive();await expire();sdk.rpc.mockImplementation((name:string)=>name==='get_current_memberships_v1'?rpcReply(null,new Error('synthetic membership outage')):rpcReply(null));
  await act(async()=>{await client.refetchQueries({queryKey:['current-tenant-memberships',actorA]});});await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('Não foi possível confirmar seus acessos'));
  sdk.rpc.mockImplementation(()=>rpcReply(rows[actorA]));fireEvent.click(screen.getByRole('button',{name:'Tentar novamente'}));await waitFor(()=>expect(screen.getByRole('alert')).toHaveTextContent('demorou mais que o esperado'));expect(screen.queryByLabelText('current tenant')).toBeNull();await late(held);expect(getActiveTenantId()).toBeNull();
 });
 it('clears deadline and aborts pending work on unmount without touching a replacement context',async()=>{
  render(<Story/>);await readyA();const {held,abort}=holdActivation();vi.useFakeTimers();await emit(session(actorA,tenantC));await advance(5);cleanup();setActiveTenantId(tenantC);await advance(10001);vi.useRealTimers();await late(held);expect(abort).toHaveBeenCalledTimes(1);expect(sdk.refreshSession).not.toHaveBeenCalled();expect(getActiveTenantId()).toBe(tenantC);
 });
});
