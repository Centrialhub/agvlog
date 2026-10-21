// No database or deployed Auth is contacted: exercise the handler with Supabase HTTP fixtures.
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
vi.hoisted(()=>vi.stubGlobal('Deno',{env:{get:()=>undefined}}));
afterAll(()=>vi.unstubAllGlobals());
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { handleDriverAccess } from '../../supabase/functions/manage-driver-access/handler';

const tenant = '11111111-1111-4111-8111-111111111111';
const actor = '22222222-2222-4222-8222-222222222222';
const driver = '33333333-3333-4333-8333-333333333333';
const user = '44444444-4444-4444-8444-444444444444';
const workspace = '55555555-5555-4555-8555-555555555555';
let driverWorkspace: string | null;
const password = 'SenhaNova12345';
let authorized: boolean, linked: boolean, managed: boolean, scopeError: string | null, authError: string | null;
let calls: Array<{ path: string; method: string; body: Record<string, unknown> }>;
let admin: SupabaseClient;
let listSize: number;
const caller = { auth: { getUser: vi.fn() } };
beforeEach(() => {
  authorized = true; linked = false; managed = true; scopeError = null; authError = null; calls = []; listSize = 0;
  driverWorkspace = workspace;
  caller.auth.getUser.mockReset();
  caller.auth.getUser.mockResolvedValue({ data: { user: { id: actor } }, error: null });
  admin = createClient('https://fixture.invalid', 'fixture-service-key', { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: async (input, init) => {
    const url = new URL(String(input)); const body = init?.body ? JSON.parse(String(init.body)) : {}; const path = url.pathname; const method = init?.method ?? 'GET'; calls.push({ path, method, body });
    let payload: unknown = {}; let status = 200;
    if (path === '/rest/v1/tenant_memberships') {
      payload = url.searchParams.get('role') === 'eq.driver'
        ? Array.from({ length: Math.max(0, Math.min(Number(url.searchParams.get('limit') ?? 500), listSize - Number(url.searchParams.get('offset') ?? 0))) }, (_, index) => ({ user_id: `${user.slice(0, -5)}${String(index + Number(url.searchParams.get('offset') ?? 0)).padStart(5, '0')}` }))
        : authorized ? { role: 'admin' } : null;
    } else if (path === '/rest/v1/drivers') payload = url.searchParams.get('select') === 'user_id' ? [] : { id: driver, name: 'João', user_id: linked ? user : null, active: true, workspace_id: driverWorkspace };
    else if (path.endsWith('/prepare_driver_access_v1')) payload = 'João';
    else if (path.endsWith('/driver_access_scope_v1')) {
      payload = scopeError ? { message: scopeError } : { managed, active: true, retired: false, deleted: false, email: managed ? 'joao@usuario.com' : 'joao@antigo.com', tenant_id: tenant };
      if (scopeError) status = 400;
    } else if (path.startsWith('/auth/v1/admin/users')) {
      payload = authError ? { msg: authError, code: 'email_exists' } : { id: user, email: 'joao@usuario.com' };
      if (authError) status = 422;
    }
    return new Response(JSON.stringify(payload), { status, headers: { 'Content-Type': 'application/json' } });
  } } });
});
// Synthetic claims only: the caller getUser fixture models prior JWT verification.
// These tests do not verify a signature or contact deployed Auth.
function contextToken(claims: Record<string, unknown> = { active_tenant_id: tenant }) {
  const encode = (value: Record<string, unknown>) => btoa(JSON.stringify(value)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  return `Bearer ${encode({ alg: 'HS256', typ: 'JWT' })}.${encode({ sub: actor, role: 'authenticated', ...claims })}.fixture-signature`;
}
type RequestContext = { authorization?: string | null; headerTenant?: string | null; alternateHeader?: string };
const request = (body: Record<string, unknown>, context: RequestContext = {}) => {
  const headers = new Headers();
  const authorization = context.authorization === undefined ? contextToken() : context.authorization;
  const headerTenant = context.headerTenant === undefined ? tenant : context.headerTenant;
  if (authorization !== null) headers.set('Authorization', authorization);
  if (headerTenant !== null) headers.set('x-agvlog-tenant-id', headerTenant);
  if (context.alternateHeader !== undefined) headers.set('x-active-tenant-id', context.alternateHeader);
  return handleDriverAccess(new Request('https://fixture.invalid', {
    method: 'POST', headers, body: JSON.stringify({ tenant_id: tenant, driver_id: driver, ...body }),
  }), caller as unknown as SupabaseClient, admin, {});
};
describe('managed driver access endpoint', () => {
  it('rejects an invalid session before database access', async () => {
    caller.auth.getUser.mockResolvedValue({ data: { user: null }, error: null }); expect((await request({ action: 'create' })).status).toBe(401); expect(calls).toHaveLength(0);
  });
  it('rejects non-admin callers before Auth administration', async () => {
    authorized = false; expect((await request({ action: 'create', username: 'joao', password })).status).toBe(403); expect(calls.some(call => call.path.startsWith('/auth/'))).toBe(false);
  });
  it('creates a confirmed synthetic login with a one-use authorization and driver link', async () => {
    const response = await request({ action: 'create', username: ' Joao ', password, workspace_id: user }); expect(response.status).toBe(200);
    const prepare = calls.find(call => call.path.endsWith('/prepare_driver_access_v1'))!;
    expect(prepare.body).toMatchObject({ _tenant_id: tenant, _actor_id: actor, _driver_id: driver, _email: 'joao@usuario.com' });
    expect(prepare.body).not.toHaveProperty('password');
    const create = calls.find(call => call.path === '/auth/v1/admin/users')!;
    expect(create.body).toMatchObject({ email: 'joao@usuario.com', password, email_confirm: true, app_metadata: {
      driver_username_managed: true, driver_access_tenant_id: tenant,
      driver_workspace_managed: true, driver_access_workspace_id: workspace,
    } });
    expect(JSON.stringify(await response.json())).not.toContain(password); expect(calls.at(-1)?.path).toContain('cancel_auth_invite');
    expect(calls.some(call => call.path.includes('/invite'))).toBe(false);
  });
  it('refuses an unavailable persisted workspace before reserving or creating Auth access', async () => {
    driverWorkspace = null;
    expect((await request({ action: 'create', username: 'joao', password, workspace_id: workspace })).status).toBe(409);
    expect(calls.some(call => call.path.includes('/rpc/') || call.path.startsWith('/auth/'))).toBe(false);
  });
  it('rejects invalid usernames without creating an authorization', async () => {
    expect((await request({ action: 'create', username: 'email@empresa.com', password })).status).toBe(400); expect(calls.some(call => call.path.includes('/rpc/'))).toBe(false);
  });
  it('rejects weak passwords before Auth mutations', async () => {
    expect((await request({ action: 'create', username: 'joao', password: 'fraca' })).status).toBe(400); expect(calls.some(call => call.path.startsWith('/auth/'))).toBe(false);
  });
  it('does not convert an existing legacy login', async () => {
    linked = true; managed = false; expect((await request({ action: 'create', username: 'joao', password })).status).toBe(409); expect(calls.some(call => call.path.startsWith('/auth/'))).toBe(false);
    expect((await request({ action: 'password', password })).status).toBe(409);
  });
  it('cleans the authorization after a username collision and asks for a different name', async () => {
    authError = 'User already registered'; const response = await request({ action: 'create', username: 'joao', password }); expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'Este usuário já está em uso. Escolha outro usuário.' }); expect(calls.at(-1)?.path).toContain('cancel_auth_invite');
  });
  it('requires an identified credential command instead of the former unguarded password call', async () => {
    linked = true; expect((await request({ action: 'password', password, email: 'attack@empresa.com' })).status).toBe(409);
    expect(calls.some(call => call.path.startsWith('/auth/'))).toBe(false);
  });
  it('blocks shared and privileged accounts before any Auth mutation', async () => {
    linked = true; scopeError = 'driver_account_shared_or_other_role'; expect((await request({ action: 'password', password })).status).toBe(409); expect((await request({ action: 'retire_legacy' })).status).toBe(409); expect(calls.some(call => call.path.startsWith('/auth/'))).toBe(false);
  });
  it('revokes access before soft deleting legacy Auth and never hard deletes audit references', async () => {
    linked = true; managed = false; expect((await request({ action: 'retire_legacy' })).status).toBe(200);
    const revoke = calls.findIndex(call => call.body._retire === true); const deletion = calls.findIndex(call => call.method === 'DELETE'); expect(revoke).toBeGreaterThan(-1); expect(deletion).toBeGreaterThan(revoke); expect(calls[deletion].body).toEqual({ should_soft_delete: true });
  });
  it('does not delete an account from the new model during legacy cleanup', async () => {
    linked = true; scopeError = 'new_driver_account_cannot_be_retired_as_legacy'; expect((await request({ action: 'retire_legacy' })).status).toBe(409); expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  });
  it('includes legacy accounts beyond one page and excludes managed accounts from the list', async () => {
    listSize = 501; managed = false;
    const legacy = await request({ action: 'legacy_list' }); expect(legacy.status).toBe(200); expect((await legacy.json()).accounts).toHaveLength(501);
    managed = true; const current = await request({ action: 'legacy_list' }); expect((await current.json()).accounts).toEqual([]);
  });
  it('shows shared legacy accounts as blocked without deleting them', async () => {
    listSize = 1; scopeError = 'driver_account_shared_or_other_role';
    const response = await request({ action: 'legacy_list' }); const { accounts } = await response.json(); expect(accounts).toHaveLength(1); expect(accounts[0].blocked).toContain('Conta compartilhada'); expect(calls.some(call => call.method === 'DELETE')).toBe(false);
  });
  it('reports a retryable Auth deletion failure after relational revocation', async () => {
    linked = true; managed = false; authError = 'upstream rejected'; const response = await request({ action: 'retire_legacy' }); expect(response.status).toBe(503); expect((await response.json()).error).toContain('exclusão da conta precisa ser tentada novamente'); expect(calls.some(call => call.body._retire === true)).toBe(true);
  });
});

describe('verified active-tenant boundary before privileged driver access', () => {
  const otherTenant = '55555555-5555-4555-8555-555555555555';
  const cases: Array<{ name: string; context?: RequestContext; body?: Record<string, unknown>; status?: number }> = [
    { name: 'missing selection header', context: { headerTenant: null } },
    { name: 'incorrect header name', context: { headerTenant: null, alternateHeader: tenant } },
    { name: 'header differs from body and claim', context: { headerTenant: otherTenant } },
    { name: 'claim differs from body and header', context: { authorization: contextToken({ active_tenant_id: otherTenant }) } },
    { name: 'body differs from header and claim', body: { tenant_id: otherTenant } },
    { name: 'body/header agree but the claim differs', body: { tenant_id: otherTenant }, context: { headerTenant: otherTenant } },
    { name: 'body/claim agree but the header differs', body: { tenant_id: otherTenant }, context: { authorization: contextToken({ active_tenant_id: otherTenant }) } },
    { name: 'header/claim agree but the body differs', context: { headerTenant: otherTenant, authorization: contextToken({ active_tenant_id: otherTenant }) } },
    { name: 'missing signed claim', context: { authorization: contextToken({}) } },
    { name: 'non-string signed claim', context: { authorization: contextToken({ active_tenant_id: 42 }) } },
    { name: 'invalid signed tenant value', context: { authorization: contextToken({ active_tenant_id: 'not-a-tenant' }) } },
    { name: 'missing body tenant', body: { tenant_id: undefined }, status: 400 },
  ];

  it.each(cases)('rejects $name without database, RPC or admin Auth calls', async ({ context, body, status = 409 }) => {
    const response = await request({ action: 'create', username: 'joao', password, ...body }, context);
    expect(response.status).toBe(status);
    if (status === 409) expect(await response.json()).toEqual({ error: 'tenant_context_mismatch' });
    expect(caller.auth.getUser).toHaveBeenCalledOnce();
    expect(calls).toEqual([]); // fetch records every admin DB/RPC/Auth request
  });

  it.each(['inspect', 'create', 'password', 'convert', 'credential_status', 'legacy_list', 'retire_legacy'])('checks context before action %s reaches any privileged client', async action => {
    const response = await request({ action, username: 'joao', password }, { headerTenant: otherTenant });
    expect(response.status).toBe(409); expect(await response.json()).toEqual({ error: 'tenant_context_mismatch' });
    expect(caller.auth.getUser).toHaveBeenCalledOnce(); expect(calls).toEqual([]);
  });

  it.each([null, 'Bearer invalid', contextToken()])('requires getUser verification before trusting token %s', async authorization => {
    caller.auth.getUser.mockResolvedValueOnce({ data: { user: { id: actor } }, error: { code: 'bad_jwt', message: 'Invalid JWT' } });
    const response = await request({ action: 'create', username: 'joao', password }, { authorization });
    expect(response.status).toBe(401);
    expect(caller.auth.getUser).toHaveBeenCalledOnce(); expect(calls).toEqual([]);
  });

  it('allows the matching verified body/header/claim into the ordinary scoped authorization', async () => {
    linked = true;
    const response = await request({ action: 'inspect' });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ kind: 'managed', user_id: user, username: 'joao', active: true });
    expect(caller.auth.getUser).toHaveBeenCalledOnce();
    expect(calls.map(call => call.path)).toEqual([
      '/rest/v1/tenant_memberships', '/rest/v1/drivers', '/rest/v1/rpc/driver_access_scope_v1',
    ]);
    expect(calls.some(call => call.path.startsWith('/auth/'))).toBe(false);
  });
});
