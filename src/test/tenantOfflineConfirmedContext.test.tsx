import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { Session } from '@supabase/supabase-js';
import { TenantProvider, useTenant } from '@/hooks/useTenant';
import { clearTenantMembershipCache, isMembershipTransportFailure, readTenantMemberships, saveTenantMembershipCache } from '@/lib/tenantMemberships';
import { readConfirmedDriverContext } from '@/lib/tenant/offlineConfirmedTenantContext';
import { clearActiveTenantId, getActiveTenantId } from '@/lib/tenant/activeTenantContext';

// Real provider/reader/cache; only the SDK transport and already supplied Auth
// state are synthetic. Native GoTrue verification remains the owner's gate.
const sdk = vi.hoisted(() => ({ rpc: vi.fn(), session: null as Session | null, refreshSession: vi.fn() }));
vi.mock('@/hooks/useAuth', () => ({ useAuth: () => ({ user: sdk.session?.user ?? null, session: sdk.session, loading: false, signOut: vi.fn() }) }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: sdk.rpc, auth: { refreshSession: sdk.refreshSession } } }));
const actor = 'a8000000-0000-4000-8000-000000000001';
const tenant = 'a8000000-0000-4000-8000-000000000011';
const workspace = 'a8000000-0000-4000-8000-000000000021';
const sessionId = 'a8000000-0000-4000-8000-000000000031';
const other = 'a8000000-0000-4000-8000-000000000099';
const row = { tenant_id: tenant, role: 'driver', tenant_name: 'Synthetic driver tenant', plan_key: 'qa', timezone: 'America/Sao_Paulo' };
type Reply = { data: unknown; error: null | { code: string; message: string }; status: number };
const ok = (data: unknown): Reply => ({ data, error: null, status: 200 });
const network = (): Reply => ({ data: null, status: 0, error: { code: '', message: 'TypeError: Failed to fetch' } });
function session(nonce = 'initial', claims: Record<string, unknown> = {}): Session {
  const payload = btoa(JSON.stringify({ sub: actor, role: 'authenticated', active_tenant_id: tenant, active_workspace_id: workspace, session_id: sessionId, exp: Math.floor(Date.now() / 1000) + 3600, nonce, ...claims })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { user: { id: actor }, access_token: `eyJhbGciOiJFUzI1NiJ9.${payload}.synthetic`, refresh_token: 'synthetic', token_type: 'bearer', expires_in: 3600 } as Session;
}
function rpcReply(value: Reply | Promise<Reply>) {
  const promise = Promise.resolve(value); return Object.assign(promise, { abortSignal: () => promise });
}
let client: QueryClient, membershipReply: Reply, portalReply: Reply;
function Probe() {
  const state = useTenant(); return <><output aria-label="tenant">{state.currentTenant?.id ?? 'none'}</output><output aria-label="role">{state.currentRole ?? 'none'}</output></>;
}
function story() { return <QueryClientProvider client={client}><TenantProvider><Probe /></TenantProvider></QueryClientProvider>; }
function restart() { cleanup(); client.clear(); client = new QueryClient({ defaultOptions: { queries: { retry: false } } }); return render(story()); }
async function warm() {
  render(story()); await waitFor(() => expect(screen.getByLabelText('role')).toHaveTextContent('driver'));
  await waitFor(() => expect(readConfirmedDriverContext(actor, sdk.session)).not.toBeNull());
}
beforeEach(() => {
  vi.resetAllMocks(); localStorage.clear(); clearActiveTenantId();
  vi.spyOn(Navigator.prototype, 'onLine', 'get').mockReturnValue(true);
  sdk.session = session(); membershipReply = ok([row]); portalReply = ok([]);
  sdk.refreshSession.mockImplementation(async () => ({ data: { session: sdk.session }, error: null }));
  sdk.rpc.mockImplementation((name: string) => {
    if (name === 'get_current_memberships_v1') return rpcReply(membershipReply);
    if (name === 'get_user_portal_tenants') return rpcReply(portalReply);
    throw new Error('Unexpected RPC ' + name);
  });
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});
afterEach(() => { cleanup(); client.clear(); localStorage.clear(); clearActiveTenantId(); vi.restoreAllMocks(); vi.useRealTimers(); });

describe('confirmed driver fallback with navigator online and failed transport', () => {
  it('opens only the signed, previously confirmed driver scope after a real provider restart', async () => {
    membershipReply = ok([{ ...row, tenant_id: other, tenant_name: 'Other tenant', role: 'operator' }, row]);
    localStorage.setItem('agvlog_tenant_id', other); await warm();
    expect(getActiveTenantId()).toBe(tenant); const before = localStorage.getItem(`agvlog:confirmed-driver-context:v1:${actor}`);
    membershipReply = network(); restart(); await waitFor(() => expect(screen.getByLabelText('role')).toHaveTextContent('driver'));
    expect(screen.getByLabelText('tenant')).toHaveTextContent(tenant); expect(getActiveTenantId()).toBe(tenant);
    expect(localStorage.getItem(`agvlog:confirmed-driver-context:v1:${actor}`)).toBe(before);
  });
  it('does not promote a legacy membership cache into a confirmed driver context', async () => {
    saveTenantMembershipCache(actor, [{ tenant_id: tenant, role: 'driver', tenants: { id: tenant, name: 'Old cache', plan_key: 'qa', timezone: 'UTC' } }]);
    membershipReply = network(); render(story()); await screen.findByRole('alert'); expect(screen.queryByLabelText('tenant')).toBeNull();
  });
  it.each([
    [401, 'invalid_jwt'], [403, '42501'], [500, ''], [200, ''], [0, '42501'],
  ])('never falls back on status%s/code%s, even with a fetch-looking HTTP string', async (status, code) => {
    await warm(); membershipReply = { data: null, status, error: { code, message: 'TypeError: Failed to fetch' } };
    restart(); await screen.findByRole('alert'); expect(screen.queryByLabelText('tenant')).toBeNull();
    expect(readConfirmedDriverContext(actor, sdk.session)).toBeNull();
  });
  it('does not fall back on malformed successful membership data', async () => {
    await warm(); membershipReply = ok([{ ...row, timezone: null }]); restart();
    await screen.findByRole('alert'); expect(readConfirmedDriverContext(actor, sdk.session)).toBeNull();
  });
  it('does not revive a revoked driver when empty operational memberships are followed by portal transport failure', async () => {
    await warm(); membershipReply = ok([]); portalReply = network(); restart();
    await screen.findByRole('alert'); expect(readConfirmedDriverContext(actor, sdk.session)).toBeNull();
  });
  it('invalidates the confirmation on authoritative empty data and prevents a later transport fallback', async () => {
    await warm(); membershipReply = ok([]); restart(); await waitFor(() => expect(screen.getByLabelText('role')).toHaveTextContent('none'));
    expect(readConfirmedDriverContext(actor, sdk.session)).toBeNull(); membershipReply = network(); restart(); await screen.findByRole('alert');
  });
  it('invalidates the confirmation after a role downgrade', async () => {
    await warm(); membershipReply = ok([{ ...row, role: 'operator' }]); restart(); await waitFor(() => expect(screen.getByLabelText('role')).toHaveTextContent('operator'));
    expect(readConfirmedDriverContext(actor, sdk.session)).toBeNull(); membershipReply = network(); restart(); await screen.findByRole('alert');
  });
  it.each([{ active_workspace_id: other }, { active_tenant_id: other }, { session_id: other }, { exp: 1 }])('rejects changed/expired signed context %j', async claims => {
    await warm(); sdk.session = session('changed', claims); membershipReply = network(); restart(); await screen.findByRole('alert'); expect(screen.queryByLabelText('role')).toBeNull();
  });
  it('clears the confirmation through the existing Auth cache-cleanup entry point', async () => {
    await warm(); clearTenantMembershipCache(actor); membershipReply = network(); restart(); await screen.findByRole('alert');
  });
});

describe('the reader creates an internal tag only for a failed operational fetch', () => {
  it('tags status0/codeempty fetch failures and cannot be spoofed by HTTP JSON', async () => {
    membershipReply = network(); const cause = await readTenantMemberships(new AbortController().signal).catch(error => error);
    expect(isMembershipTransportFailure(cause)).toBe(true);
    expect(isMembershipTransportFailure({ name: 'MembershipTransportFailure', message: 'TypeError: Failed to fetch' })).toBe(false);
    membershipReply = { ...network(), status: 403 }; const denied = await readTenantMemberships(new AbortController().signal).catch(error => error);
    expect(isMembershipTransportFailure(denied)).toBe(false);
  });
  it('does not tag abort or an arbitrary rejected TypeError without an SDK response', async () => {
    membershipReply = network(); const controller = new AbortController(); controller.abort();
    const aborted = await readTenantMemberships(controller.signal).catch(error => error);
    expect(aborted.name).toBe('AbortError'); expect(isMembershipTransportFailure(aborted)).toBe(false);
    sdk.rpc.mockImplementation(() => ({ abortSignal: () => Promise.reject(new TypeError('Failed to fetch')) }));
    const untagged = await readTenantMemberships(new AbortController().signal).catch(error => error);
    expect(isMembershipTransportFailure(untagged)).toBe(false);
  });
  it('bounds timeout without marking it as transport fallback', async () => {
    vi.useFakeTimers(); sdk.rpc.mockImplementation(() => ({ abortSignal: () => new Promise(() => {}) }));
    const pending = readTenantMemberships(new AbortController().signal).catch(error => error);
    await vi.advanceTimersByTimeAsync(8100); const cause = await pending;
    expect(cause.message).toContain('Tempo esgotado'); expect(isMembershipTransportFailure(cause)).toBe(false);
  });
});

describe('mounted fallback expiry and identity boundaries', () => {
  it('hides an already open fallback at its original expiry without another network response', async () => {
    await warm(); membershipReply = network(); vi.useFakeTimers(); restart();
    await act(async () => { await vi.advanceTimersByTimeAsync(50); });
    expect(screen.getByLabelText('role')).toHaveTextContent('driver');
    const proof = JSON.parse(localStorage.getItem(`agvlog:confirmed-driver-context:v1:${actor}`)!);
    await act(async () => { await vi.advanceTimersByTimeAsync(Date.parse(proof.expires_at) - Date.now() + 1); });
    expect(screen.queryByLabelText('tenant')).toBeNull();
    expect(localStorage.getItem(`agvlog:confirmed-driver-context:v1:${actor}`)).toBeNull();
  });
  it.each([{ active_workspace_id: other }, { session_id: other }, { role: 'anon' }, { exp: 1 }])('hides old fallback immediately on changed binding %j while the next read is pending', async claims => {
    await warm(); membershipReply = network(); const view = restart();
    await waitFor(() => expect(screen.getByLabelText('role')).toHaveTextContent('driver'));
    sdk.rpc.mockImplementation(() => ({ abortSignal: () => new Promise(() => {}) }));
    sdk.session = session('changed-pending', claims); view.rerender(story());
    expect(screen.queryByLabelText('tenant')).toBeNull();
    expect(getActiveTenantId()).toBeNull();
  });
  it('never promotes invalid cached JSON during a provider restart', async () => {
    await warm(); localStorage.setItem(`agvlog:confirmed-driver-context:v1:${actor}`, '{invalid');
    membershipReply = network(); restart(); await screen.findByRole('alert');
    expect(screen.queryByLabelText('tenant')).toBeNull();
  });
  it('logout and actor replacement preserve durable command and PDF markers', async () => {
    await warm(); localStorage.setItem('synthetic-durable-outbox-marker', 'same-request-id');
    localStorage.setItem('synthetic-durable-pdf-marker', 'JVBERi0xLjc=');
    membershipReply = network(); const view = restart();
    await waitFor(() => expect(screen.getByLabelText('role')).toHaveTextContent('driver'));
    clearTenantMembershipCache(actor); sdk.session = null; view.rerender(story());
    expect(screen.getByLabelText('tenant')).toHaveTextContent('none');
    expect(getActiveTenantId()).toBeNull();
    expect(localStorage.getItem('synthetic-durable-outbox-marker')).toBe('same-request-id');
    expect(localStorage.getItem('synthetic-durable-pdf-marker')).toBe('JVBERi0xLjc=');
    sdk.session = session('other-user', { sub: other }); sdk.session.user.id = other;
    view.rerender(story()); await screen.findByRole('alert');
    expect(screen.queryByLabelText('tenant')).toBeNull();
  });
});
