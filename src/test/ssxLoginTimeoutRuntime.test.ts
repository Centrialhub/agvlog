// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  account: {} as Record<string, unknown>,
  updates: [] as Array<Record<string, unknown>>,
  audits: [] as Array<Record<string, unknown>>,
  rpcCalls: [] as string[],
  authenticated: true,
  role: 'admin',
}));

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: state.authenticated ? { id: 'synthetic-user' } : null }, error: null }) },
    from: (table: string) => {
      if (table !== 'integration_accounts') throw Error('Unexpected synthetic table');
      let update: Record<string, unknown> | null = null;
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: state.account, error: null }),
        update: (value: Record<string, unknown>) => { update = value; return query; },
        then: (resolve: (value: unknown) => unknown) => {
          if (update) state.updates.push(update);
          return Promise.resolve({ data: null, error: null }).then(resolve);
        },
      };
      return query;
    },
  }),
}));
vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({ isCronRequest: vi.fn().mockResolvedValue(false) }));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({ requireIntegrationCapability: vi.fn().mockResolvedValue(null) }));
vi.mock('../../supabase/functions/_shared/ssx-utils.ts', async (importOriginal) => ({
  ...await importOriginal<Record<string, unknown>>(),
  getTenantRole: async () => state.role,
  getWorkspaceRoleForAccount: async () => state.role,
  requireWorkspaceAccountContext: async () => null,
  logIntegration: async (_client: unknown, details: Record<string, unknown>) => { state.audits.push(details); },
}));

let getAdminToken: typeof import('../../supabase/functions/_shared/ssx-utils.ts').getAdminToken;
const cleanups: Array<() => void> = [];
const syntheticKey = 'AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=';
const tick = async () => { for (let i = 0; i < 80; i++) await Promise.resolve(); };

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => ({ SUPABASE_URL: 'https://database.invalid', SUPABASE_SERVICE_ROLE_KEY: 'synthetic-service', SUPABASE_ANON_KEY: 'synthetic-anon', AGVLOG_ENCRYPTION_KEY: syntheticKey, SSX_ALLOWED_ORIGINS: 'https://ssx.invalid' } as Record<string, string>)[name] },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  ({ getAdminToken } = await import('../../supabase/functions/_shared/ssx-utils.ts'));
  const handlerPath = '../../supabase/functions/ssx-login/index.ts';
  await import(handlerPath);
});
beforeEach(() => {
  vi.useFakeTimers();
  state.account = { id: 'synthetic-account', tenant_id: 'synthetic-tenant', workspace_id: 'synthetic-workspace', base_url: 'https://ssx.invalid', username: 'synthetic-username', password_encrypted: 'synthetic-password', hashauth: 'synthetic-hash', hashcode: 'synthetic-central', settings: { request_timeout_ms: 1000 } };
  state.updates = []; state.audits = []; state.rpcCalls = []; state.authenticated = true; state.role = 'admin';
});
afterEach(async () => { for (const release of cleanups.splice(0)) release(); await tick(); vi.useRealTimers(); });
afterAll(() => { vi.unstubAllGlobals(); });

function stalledTransport(stage: 'headers' | 'body') {
  let signal: AbortSignal | undefined;
  let resolveLate: ((value: unknown) => void) | undefined;
  const fetch = vi.fn(async (_url: string, init: RequestInit) => {
    signal = init.signal as AbortSignal | undefined;
    const stuck = new Promise<unknown>((resolve, reject) => {
      resolveLate = resolve;
      const abort = () => reject(new DOMException('Synthetic transport cancelled', 'AbortError'));
      signal?.addEventListener('abort', abort, { once: true });
      cleanups.push(abort);
    });
    return stage === 'headers' ? await stuck : { ok: true, status: 200, text: () => stuck };
  });
  vi.stubGlobal('fetch', fetch);
  return { fetch, signal: () => signal, late: () => resolveLate?.(stage === 'headers' ? new Response(JSON.stringify({ AccessToken: 'synthetic-late-token', ExpiresIn: 60 })) : JSON.stringify({ AccessToken: 'synthetic-late-token', ExpiresIn: 60 })) };
}

function invoke(force = false) {
  if (!state.handler) throw Error('Handler was not registered');
  return state.handler(new Request('https://edge.invalid/ssx-login', { method: 'POST', headers: { Authorization: 'Bearer synthetic-user', 'Content-Type': 'application/json' }, body: JSON.stringify({ integration_account_id: 'synthetic-account', force }) }));
}
function adminConfig(enabled = true) {
  return { baseUrl: 'https://ssx.invalid', apiVersion: 'v3', token: 'synthetic-tracking-token', pollWindowMinutes: 15, requestTimeoutMs: 1000, settings: { administration_enabled: enabled }, hashauth: 'synthetic-hash', hashcode: 'synthetic-central', username: 'synthetic-username', passwordEncrypted: 'synthetic-password' };
}
const adminClient = () => ({ rpc: async (name: string) => { state.rpcCalls.push(name); return { data: null, error: null }; } });

describe('SSX login backoff values', () => {
  const useCachedToken = (backoff: unknown) => {
    state.account.settings = { ssx_login_backoff_until: backoff };
    state.account.token_cache = 'synthetic-cached-token';
    state.account.token_expires_at = new Date(Date.now() + 7200_000).toISOString();
    const fetch = vi.fn(() => { throw Error('Unexpected transport'); });
    vi.stubGlobal('fetch', fetch);
    return fetch;
  };
  it.each(['ISO', 'milliseconds'])('preserves an active %s cooldown without transport or writes', async format => {
    const future = Date.now() + 60_000;
    const value = format === 'ISO' ? new Date(future).toISOString() : future;
    const fetch = useCachedToken(value);
    const response = await invoke();
    expect(response.status).toBe(429);
    expect(await response.json()).toMatchObject({ code: 'SSX_LOGIN_BACKOFF', retry_at: value });
    expect(fetch).not.toHaveBeenCalled(); expect(state.updates).toHaveLength(0);
  });
  it.each([undefined, null, false, true, '', 'not-a-date', 0, -1, {}, [], ['2099-01-01'], { until: '2099-01-01' }])(
    'does not coerce malformed or inactive JSON cooldown %j into a future date', async value => {
      const fetch = useCachedToken(value);
      const response = await invoke();
      expect(response.status).toBe(200); expect(await response.json()).toMatchObject({ cached: true });
      expect(fetch).not.toHaveBeenCalled(); expect(state.updates).toHaveLength(0);
    });
  it('preserves expiry and explicit force while checking authorization first', async () => {
    const fetch = useCachedToken(new Date(Date.now() - 1).toISOString());
    expect((await invoke()).status).toBe(200);
    state.account.settings = { ssx_login_backoff_until: new Date(Date.now() + 60_000).toISOString() };
    expect((await invoke(true)).status).toBe(200);
    state.authenticated = false; expect((await invoke(true)).status).toBe(401);
    state.authenticated = true; state.role = 'member'; expect((await invoke(true)).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled(); expect(state.updates).toHaveLength(0);
  });
});

describe('SSX login transport deadline', () => {
  for (const stage of ['headers', 'body'] as const) {
    it('ends Tracking login when upstream stalls at ' + stage + ', preserving backoff and preventing late cache writes', async () => {
      const transport = stalledTransport(stage);
      let settled = false;
      const pending = invoke().then(response => { settled = true; return response; });
      await tick(); expect(transport.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000); await tick();
      expect(settled).toBe(true);
      expect(transport.signal()?.aborted).toBe(true);
      const response = await pending;
      expect(response.status).toBe(502);
      const body = await response.json();
      expect(body.error).toBe('SSX unreachable');
      expect(new Date(body.retry_at).getTime()).toBeGreaterThan(Date.now());
      expect(state.updates).toHaveLength(1);
      expect(state.updates[0]).toMatchObject({ status: 'degraded', last_error: 'SSX network request failed' });
      expect(state.updates[0]).not.toHaveProperty('token_cache');
      expect(state.audits).toHaveLength(1);
      expect(JSON.stringify(state.audits)).not.toContain('synthetic-password');
      transport.late(); await tick(); expect(state.updates).toHaveLength(1);
      expect(vi.getTimerCount()).toBe(0);
    });
    it('ends opted-in Administration login when upstream stalls at ' + stage + ', without persisting a late token', async () => {
      const transport = stalledTransport(stage);
      let settled = false;
      const pending = getAdminToken(adminConfig(), adminClient(), 'synthetic-account').then(value => { settled = true; return value; });
      await tick(); expect(transport.fetch).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1000); await tick();
      expect(settled).toBe(true);
      expect(transport.signal()?.aborted).toBe(true);
      expect(await pending).toEqual({ token: null, error: 'SSX_ADMIN_LOGIN_NETWORK_FAILED' });
      transport.late(); await tick();
      expect(state.rpcCalls).toEqual(['get_ssx_admin_token_cache_v1']);
      expect(vi.getTimerCount()).toBe(0);
    });
  }

  it('preserves successful Tracking login, provider TTL and unversioned query contract', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ AccessToken: 'synthetic-valid-token', ExpiresIn: 60 })));
    vi.stubGlobal('fetch', fetch);
    const response = await invoke(); expect(response.status).toBe(200);
    expect(state.updates).toHaveLength(1);
    expect(state.updates[0].token_cache).toBe('synthetic-valid-token');
    expect(new Date(String(state.updates[0].token_expires_at)).getTime() - Date.now()).toBe(60_000);
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/Login'); expect(url.searchParams.get('HashAuth')).toBe('synthetic-hash');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves HTTP authentication failures without exposing upstream body or leaving a timer', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('synthetic-upstream-secret', { status: 401 })));
    const response = await invoke(); expect(response.status).toBe(502);
    expect(state.updates[0].status).toBe('invalid_credentials');
    expect(JSON.stringify(await response.json())).not.toContain('synthetic-upstream-secret');
    expect(vi.getTimerCount()).toBe(0);
  });
  it('preserves valid Tracking cache without transport', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    state.account.token_cache = 'synthetic-cached-token'; state.account.token_expires_at = new Date(Date.now() + 7200_000).toISOString();
    expect((await invoke()).status).toBe(200); expect(fetch).not.toHaveBeenCalled(); expect(state.updates).toHaveLength(0);
  });
  it('does not call upstream before authentication or role checks pass', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    state.authenticated = false; expect((await invoke()).status).toBe(401);
    state.authenticated = true; state.role = 'member'; expect((await invoke()).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled(); expect(state.updates).toHaveLength(0);
  });
  it('keeps Administration opt-in mandatory', async () => {
    const fetch = vi.fn(); vi.stubGlobal('fetch', fetch);
    expect(await getAdminToken(adminConfig(false), adminClient(), 'synthetic-account')).toEqual({ token: null, error: 'SSX_ADMINISTRATION_DISABLED' });
    expect(fetch).not.toHaveBeenCalled(); expect(state.rpcCalls).toHaveLength(0);
  });
});

describe('SSX login deadline settings and Administration success', () => {
  it.each([
    [undefined, 30_000], [0, 30_000], [-1, 30_000], [NaN, 30_000],
    [Infinity, 30_000], [true, 30_000], ['', 30_000], ['1000', 1000],
    [500.9, 500], [0.1, 1], [2 ** 31, 120_000],
  ])('normalizes timeout %s to a finite positive deadline %s', async (value, expected) => {
    const { ssxLoginTimeoutMs } = await import('../../supabase/functions/_shared/ssx-login-request.ts');
    expect(ssxLoginTimeoutMs(value)).toBe(expected);
  });
  it('stores successful Administration tokens encrypted without HashAuth and leaves no timer', async () => {
    const fetch = vi.fn().mockResolvedValue(new Response(JSON.stringify({ AccessToken: 'synthetic-admin-token', ExpiresIn: 60 })));
    vi.stubGlobal('fetch', fetch);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const client = { rpc: async (name: string, args: Record<string, unknown>) => { calls.push({ name, args }); return { data: null, error: null }; } };
    expect(await getAdminToken(adminConfig(), client, 'synthetic-account')).toEqual({ token: 'synthetic-admin-token', error: null });
    expect(calls.map(call => call.name)).toEqual(['get_ssx_admin_token_cache_v1', 'set_ssx_admin_token_cache_v1']);
    expect(calls[1].args._token_ciphertext).toMatch(/^enc:v1:/);
    expect(calls[1].args._token_ciphertext).not.toContain('synthetic-admin-token');
    const url = new URL(fetch.mock.calls[0][0]);
    expect(url.pathname).toBe('/Login'); expect(url.searchParams.has('HashAuth')).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
