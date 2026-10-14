import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Session } from '@supabase/supabase-js';
import type { Membership } from '@/lib/tenantMemberships';
import {
  clearConfirmedDriverContext, commitConfirmedDriverContext, readConfirmedDriverContext,
  stageConfirmedDriverContext, CONFIRMED_DRIVER_CONTEXT_TTL_MS,
} from '@/lib/tenant/offlineConfirmedTenantContext';

// Synthetic JWT structure only; not a GoTrue signature/authorization proof.
const actor = 'a7000000-0000-4000-8000-000000000001';
const tenant = 'a7000000-0000-4000-8000-000000000011';
const workspace = 'a7000000-0000-4000-8000-000000000021';
const sessionId = 'a7000000-0000-4000-8000-000000000031';
const other = 'a7000000-0000-4000-8000-000000000099';
const now = new Date('2026-10-14T07:00:00.000Z');
const expires = Math.floor(now.getTime() / 1000) + 3600;
const cacheKey = `agvlog:confirmed-driver-context:v1:${actor}`;
const membership: Membership = { tenant_id: tenant, role: 'driver', tenants: { id: tenant, name: 'Synthetic tenant', plan_key: 'qa', timezone: 'America/Sao_Paulo' } };
function session(claims: Record<string, unknown> = {}, user = actor): Session {
  const payload = btoa(JSON.stringify({ sub: actor, role: 'authenticated', active_tenant_id: tenant, active_workspace_id: workspace, session_id: sessionId, exp: expires, ...claims })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return { user: { id: user }, access_token: `eyJhbGciOiJFUzI1NiJ9.${payload}.synthetic-signature`, refresh_token: 'synthetic-refresh', expires_in: 3600, token_type: 'bearer' } as Session;
}
function confirm(value = session(), rows = [membership]) {
  const staged = stageConfirmedDriverContext(actor, value, rows, now);
  commitConfirmedDriverContext(staged, actor, value, { tenant, role: 'driver' }, now);
  return staged;
}
beforeEach(() => localStorage.clear());
afterEach(() => localStorage.clear());

describe('confirmed driver context cache', () => {
  it('stages without persistence and commits only the exact confirmed driver view', () => {
    const staged = stageConfirmedDriverContext(actor, session(), [membership], now);
    expect(staged).not.toBeNull(); expect(localStorage.getItem(cacheKey)).toBeNull();
    commitConfirmedDriverContext(staged, actor, session(), { tenant: other, role: 'driver' }, now);
    expect(localStorage.getItem(cacheKey)).toBeNull();
    commitConfirmedDriverContext(staged, actor, session(), { tenant, role: 'operator' }, now);
    expect(localStorage.getItem(cacheKey)).toBeNull();
    commitConfirmedDriverContext(staged, actor, session(), { tenant, role: 'driver' }, now);
    expect(readConfirmedDriverContext(actor, session(), now)).toEqual(membership);
  });
  it('stores minimum bindings and metadata, never access/refresh tokens or user metadata', () => {
    confirm(); const raw = localStorage.getItem(cacheKey)!;
    expect(raw).not.toContain(session().access_token); expect(raw).not.toContain('synthetic-refresh');
    expect(raw).not.toMatch(/access_token|refresh_token|user_metadata/);
    expect(JSON.parse(raw)).toMatchObject({ actor_id: actor, tenant_id: tenant, workspace_id: workspace, session_id: sessionId, role: 'driver' });
  });
  it.each([
    ['actor', { sub: other }, actor], ['SDK actor', {}, other],
    ['tenant', { active_tenant_id: other }, actor], ['workspace', { active_workspace_id: other }, actor],
    ['session', { session_id: other }, actor], ['Auth role', { role: 'anon' }, actor],
  ])('rejects changed %s rather than reusing the old context', (_name, claims, user) => {
    confirm(); expect(readConfirmedDriverContext(actor, session(claims, user), now)).toBeNull();
    expect(localStorage.getItem(cacheKey)).toBeNull();
  });
  it('never reads another actor cache', () => { confirm(); expect(readConfirmedDriverContext(other, session({}, other), now)).toBeNull(); });
  it.each(['owner', 'admin', 'operator', 'client'] as const)('never confirms non-driver role %s', role => {
    expect(stageConfirmedDriverContext(actor, session(), [{ ...membership, role }], now)).toBeNull();
  });
  it('rejects missing active claims despite user-editable metadata', () => {
    const value = session({ active_workspace_id: undefined });
    value.user.user_metadata = { role: 'driver', active_workspace_id: workspace };
    expect(stageConfirmedDriverContext(actor, value, [membership], now)).toBeNull();
  });
  it('rejects unknown, empty, duplicated or inconsistent selected memberships', () => {
    for (const rows of [[], [membership, membership], [{ ...membership, tenant_id: other }], [{ ...membership, tenants: { ...membership.tenants, id: other } }]]) {
      expect(stageConfirmedDriverContext(actor, session(), rows, now)).toBeNull();
    }
  });
  it('caps expiry at the live token and rejects an expired token even with a cache', () => {
    const staged = confirm()!; expect(Date.parse(staged.expires_at)).toBe(expires * 1000);
    expect(readConfirmedDriverContext(actor, session(), new Date(expires * 1000))).toBeNull();
    expect(stageConfirmedDriverContext(actor, session({ exp: expires - 3601 }), [membership], now)).toBeNull();
  });
  it('does not extend the original expiry when Auth refreshes without a new membership proof', () => {
    const staged = confirm()!, before = localStorage.getItem(cacheKey);
    const refreshed = session({ exp: expires + 3600 });
    commitConfirmedDriverContext(staged, actor, refreshed, { tenant, role: 'driver' }, new Date(now.getTime() + 1000));
    expect(localStorage.getItem(cacheKey)).toBe(before);
    expect(readConfirmedDriverContext(actor, refreshed, new Date(expires * 1000 + 1000))).toBeNull();
  });
  it('caps a long token at seven days without extending on reads', () => {
    const value = session({ exp: Math.floor(now.getTime() / 1000) + 30 * 86400 });
    const staged = confirm(value)!;
    expect(Date.parse(staged.expires_at)).toBe(now.getTime() + CONFIRMED_DRIVER_CONTEXT_TTL_MS);
    expect(readConfirmedDriverContext(actor, value, new Date(now.getTime() + CONFIRMED_DRIVER_CONTEXT_TTL_MS))).toBeNull();
  });
  it.each([
    { role: 'owner' }, { version: 2 }, { workspace_id: other }, { tenant_id: other },
    { confirmed_at: new Date(now.getTime() + 1000).toISOString() },
    { expires_at: new Date(now.getTime() + CONFIRMED_DRIVER_CONTEXT_TTL_MS + 1000).toISOString() },
    { access_token: 'unexpected-secret-field' },
  ])('rejects malformed/tampered bindings %j', mutation => {
    confirm(); localStorage.setItem(cacheKey, JSON.stringify({ ...JSON.parse(localStorage.getItem(cacheKey)!), ...mutation }));
    expect(readConfirmedDriverContext(actor, session(), now)).toBeNull();
  });
  it('clears only the specified confirmation and preserves the durable outbox marker', () => {
    confirm(); localStorage.setItem('synthetic-durable-outbox-marker', 'preserved');
    clearConfirmedDriverContext(actor); expect(localStorage.getItem(cacheKey)).toBeNull();
    expect(localStorage.getItem('synthetic-durable-outbox-marker')).toBe('preserved');
  });
});

describe('SDK expiry and invalid optional storage', () => {
  it('caps proof by earlier SDK expiry and invalidates it at that instant', () => {
    const value = session(); value.expires_at = Math.floor(now.getTime() / 1000) + 60;
    const proof = confirm(value)!;
    expect(Date.parse(proof.expires_at)).toBe(value.expires_at * 1000);
    expect(readConfirmedDriverContext(actor, value, new Date(value.expires_at * 1000))).toBeNull();
  });
  it('rejects corrupted JSON without harming durable payload markers', () => {
    localStorage.setItem(cacheKey, '{invalid'); localStorage.setItem('synthetic-durable-pdf-marker', 'preserved');
    expect(readConfirmedDriverContext(actor, session(), now)).toBeNull();
    expect(localStorage.getItem(cacheKey)).toBeNull(); expect(localStorage.getItem('synthetic-durable-pdf-marker')).toBe('preserved');
  });
});
