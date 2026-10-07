import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { AuthChangeEvent, Session } from '@supabase/supabase-js';
import { AuthProvider, useAuth } from '@/hooks/useAuth';
import { TenantProvider, useTenant } from '@/hooks/useTenant';
import type { Membership } from '@/lib/tenantMemberships';
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
afterEach(() => { cleanup(); client.clear(); sdk.listeners.clear(); clearActiveTenantId(); vi.restoreAllMocks(); });

describe('signed tenant context async isolation with actual AuthProvider/TenantProvider', () => {
  it.each(['operator','driver','owner'])('finishes a legitimate switch to target role %s through its own TOKEN_REFRESHED events, including StrictMode', async targetRole => {
    rows[actorA]=[membership(tenantA),membership(tenantB,targetRole)];
    render(<StrictMode><Story/></StrictMode>); await readyA();
    sdk.refreshSession.mockImplementationOnce(async () => {
      const validated = session(actorA, tenantA, 'validated');
      current=validated;sdk.listeners.forEach(listener=>listener('TOKEN_REFRESHED',validated));return refreshReply(validated);
    });
    const held=deferred<RefreshReply>();sdk.refreshSession.mockImplementationOnce(()=>held.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Activate target tenant' }));
    await waitFor(()=>expect(sdk.refreshSession).toHaveBeenCalledTimes(2));
    expect(activationCalls()).toEqual([['set_active_tenant_context_v1',{_tenant_id:tenantB}]]);
    const switched=session(actorA,tenantB,'switched');
    // Auth publishes its signed target before the final refresh promise settles.
    // Commit that event independently, so an outer act cannot hide the race.
    await emit(switched,'TOKEN_REFRESHED');
    await waitFor(()=>expect(screen.getByLabelText('current claim')).toHaveTextContent(tenantB));
    await act(async()=>{held.resolve(refreshReply(switched));await expect(startedActivation()).resolves.toBe(true);});
    await waitFor(() => expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantB));
    expect(getActiveTenantId()).toBe(tenantB);
    expect(screen.getByLabelText('current role')).toHaveTextContent(targetRole);
    expect(localStorage.getItem(`agvlog:tenant:v1:${actorA}`)).toBe(tenantB);
    expect(activationCalls()).toEqual([['set_active_tenant_context_v1', { _tenant_id: tenantB }]]);
    expect(sdk.refreshSession).toHaveBeenCalledTimes(2);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not continue an old actor activation after its pending validation refresh returns', async () => {
    render(<Story/>); await readyA();
    const held = deferred<RefreshReply>(); sdk.refreshSession.mockImplementationOnce(() => held.promise);
    const cancel = vi.spyOn(client, 'cancelQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Activate target tenant' }));
    await waitFor(() => expect(sdk.refreshSession).toHaveBeenCalledTimes(1));
    await readyB();
    await act(async () => { held.resolve(refreshReply(session(actorA, tenantA, 'late')));
      await expect(startedActivation()).resolves.toBe(false); });
    expect(cancel).not.toHaveBeenCalled(); expect(sdk.removeAllChannels).not.toHaveBeenCalled();
    expect(activationCalls()).toHaveLength(0); expect(getActiveTenantId()).toBe(tenantC);
    expect(screen.getByLabelText('current actor')).toHaveTextContent(actorB);
    expect(screen.getByLabelText('current tenant')).toHaveTextContent(tenantC);
  });

  it('does not continue activation after authoritative same-actor role downgrade', async () => {
    render(<Story/>); await readyA();
    const held = deferred<RefreshReply>(); sdk.refreshSession.mockImplementationOnce(() => held.promise);
    const cancel = vi.spyOn(client, 'cancelQueries');
    fireEvent.click(screen.getByRole('button', { name: 'Activate target tenant' }));
    await waitFor(() => expect(sdk.refreshSession).toHaveBeenCalledTimes(1));
    rows[actorA] = [membership(tenantA, 'driver'), membership(tenantB, 'driver')];
    await emit(session(actorA, tenantA, 'downgraded'), 'TOKEN_REFRESHED');
    // A pending signed switch can legitimately hide the screen. Observe the
    // actual membership query result before releasing the old refresh, rather
    // than requiring that pending screen to render the probe prematurely.
    await waitFor(() => {
      const authoritative = client.getQueryData<Membership[]>(['current-tenant-memberships', actorA]);
      expect(authoritative?.find(row => row.tenant_id === tenantA)?.role).toBe('driver');
    });
    await act(async () => { held.resolve(refreshReply(session(actorA, tenantA, 'old-refresh')));
      await expect(startedActivation()).resolves.toBe(false); });
    await waitFor(() => expect(screen.getByLabelText('current role')).toHaveTextContent('driver'));
    expect(cancel).not.toHaveBeenCalled(); expect(sdk.removeAllChannels).not.toHaveBeenCalled();
    expect(activationCalls()).toHaveLength(0); expect(getActiveTenantId()).toBe(tenantA);
    expect(localStorage.getItem(`agvlog:tenant:v1:${actorA}`)).toBe(tenantA);
  });

  it('does not roll back an already-issued activation into a replacement actor context', async () => {
    render(<Story/>); await readyA();
    const held = deferred<RefreshReply>();
    sdk.refreshSession.mockResolvedValueOnce(refreshReply(session(actorA, tenantA, 'validated')))
      .mockImplementationOnce(() => held.promise);
    fireEvent.click(screen.getByRole('button', { name: 'Activate target tenant' }));
    await waitFor(() => expect(sdk.refreshSession).toHaveBeenCalledTimes(2));
    expect(activationCalls()).toEqual([['set_active_tenant_context_v1', { _tenant_id: tenantB }]]);
    await readyB();
    const channelCalls = sdk.removeAllChannels.mock.calls.length;
    await act(async () => { held.resolve({ data: { session: null }, error: new Error('refresh_token_not_found') });
      await expect(startedActivation()).resolves.toBe(false); });
    expect(activationCalls()).toEqual([['set_active_tenant_context_v1', { _tenant_id: tenantB }]]);
    expect(sdk.removeAllChannels).toHaveBeenCalledTimes(channelCalls);
    expect(getActiveTenantId()).toBe(tenantC);
    expect(screen.getByLabelText('current actor')).toHaveTextContent(actorB);
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('does not refresh Auth after a passive activation returns to an unmounted provider', async () => {
    const held = deferred<{ data: null; error: null }>();
    sdk.rpc.mockImplementation((name: string) => {
      if (name === 'set_active_tenant_context_v1') return held.promise;
      if (name === 'get_current_memberships_v1') return rpcReply(rows[current?.user.id ?? ''] ?? []);
      if (name === 'get_user_portal_tenants') return rpcReply([]);
      throw new Error(`Unexpected RPC ${name}`);
    });
    const view = render(<Story/>); await emit(session(actorA, tenantC, 'mismatched-claim'));
    await waitFor(() => expect(activationCalls()).toHaveLength(1));
    view.unmount(); setActiveTenantId(tenantC);
    await act(async () => { held.resolve({ data: null, error: null }); await held.promise; });
    expect(sdk.refreshSession).not.toHaveBeenCalled(); expect(getActiveTenantId()).toBe(tenantC);
  });

  it('does not restore a header after an unmounted passive synchronization refresh completes', async () => {
    const held = deferred<RefreshReply>(); sdk.refreshSession.mockImplementationOnce(() => held.promise);
    const view = render(<Story/>); await emit(session(actorA, tenantC, 'mismatched-claim'));
    await waitFor(() => expect(sdk.refreshSession).toHaveBeenCalledTimes(1));
    view.unmount(); setActiveTenantId(tenantC);
    await act(async () => { held.resolve(refreshReply(session(actorA, tenantA, 'late-passive'))); await held.promise; });
    expect(getActiveTenantId()).toBe(tenantC);
    expect(localStorage.getItem(`agvlog:tenant:v1:${actorA}`)).toBe(tenantA);
    expect(activationCalls()).toHaveLength(1);
  });
});
