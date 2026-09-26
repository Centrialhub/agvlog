// @vitest-environment node
import { readFile } from 'node:fs/promises';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchReply = { status: number; body: string; retryAfter?: string; bodyReadFailure?: boolean };
type RpcArgs = Record<string, unknown>;

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  account: {} as Record<string, unknown>,
  cursor: { last_position_id: '7' as string, last_error_code: null as string | null, updated_at: '' },
  cursorReadError: false,
  replies: [] as FetchReply[],
  providerCalls: 0,
  windowCalls: 0,
  upsertCalls: 0,
  acks: [] as RpcArgs[],
}));

// Only the transport is mocked. The generated Edge handler and its shared
// cron, capability and SSX HTTP helpers run from the rollback bundle.
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'integration_logs') return { insert: async () => ({ error: null }) };
      if (table !== 'integration_accounts' && table !== 'ssx_rule_violation_cursors') {
        throw new Error(`Unexpected table: ${table}`);
      }
      const query = {
        select: () => query,
        eq: () => query,
        single: async () => ({ data: state.account, error: null }),
        maybeSingle: async () => ({
          data: state.cursorReadError ? null : state.cursor,
          error: state.cursorReadError ? { message: 'synthetic read failure' } : null,
        }),
      };
      return query;
    },
    rpc: async (name: string, args: RpcArgs) => {
      if (name === 'verify_agvlog_cron_secret') {
        expect(args).toEqual({ p_secret: 'synthetic-cron-secret' });
        return { data: true, error: null };
      }
      if (name === 'assert_tenant_integration_capability_v1') {
        expect(args).toEqual({ _tenant_id: 'tenant-1', _capability: 'ssx' });
        return { data: true, error: null };
      }
      if (name === 'get_ssx_rule_violation_window_v1') {
        state.windowCalls++;
        return { data: {
          expected_last_position_id: state.cursor.last_position_id,
          start_position_id: '8', end_position_id: '10', should_poll: true,
        }, error: null };
      }
      if (name === 'upsert_ssx_rule_violations_v1') {
        state.upsertCalls++;
        return { data: (args._items as unknown[]).length, error: null };
      }
      if (name === 'ack_ssx_rule_violation_window_v1') {
        state.acks.push(args);
        if (args._expected_last_position_id !== state.cursor.last_position_id) {
          return { data: false, error: null };
        }
        if (args._success === true) {
          state.cursor.last_position_id = String(args._end_position_id);
          state.cursor.last_error_code = null;
        } else {
          state.cursor.last_error_code = String(args._error_code);
        }
        state.cursor.updated_at = new Date().toISOString();
        return { data: true, error: null };
      }
      throw new Error(`Unexpected RPC: ${name}`);
    },
  }),
}));

const startAt = new Date('2026-09-26T12:00:00.000Z');

beforeAll(async () => {
  // Import a variable path returned by the generator. A static import would
  // exercise the current Edge source rather than the prepared rollback.
  const generatorPath = '../../scripts/prepare-ssx-violations-rollback.mjs';
  const generator = await import(generatorPath);
  const { entrypointPath, manifestPath } = generator.prepareSsxViolationsRollback() as {
    entrypointPath: string;
    manifestPath: string;
  };
  expect(entrypointPath.replace(/\\/g, '/')).toContain(
    '/.codex-build-audit/edge-compatible-rollback-2026-09-26/ssx-sync-rule-violations-v13/supabase/functions/ssx-sync-rule-violations/index.ts',
  );
  const reviewedManifestPath = new URL(
    '../../docs/qa/ssx-violations-compatible-rollback-manifest-2026-09-26.json', import.meta.url,
  );
  const [generatedManifest, reviewedManifest] = await Promise.all([
    readFile(manifestPath, 'utf8'),
    readFile(reviewedManifestPath, 'utf8'),
  ]);
  expect(JSON.parse(generatedManifest)).toEqual(JSON.parse(reviewedManifest));
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({
      SUPABASE_URL: 'https://db.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_ANON_KEY: 'anon',
    } as Record<string, string>)[key] },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  await import(entrypointPath);
  expect(state.handler).toBeTypeOf('function');
});
afterAll(() => { vi.unstubAllGlobals(); });

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(startAt);
  state.account = {
    id: 'account-1', tenant_id: 'tenant-1', provider: 'ssx',
    base_url: 'https://integration.systemsatx.com.br',
    token_cache: 'synthetic-token',
    token_expires_at: new Date(startAt.getTime() + 24 * 60 * 60_000).toISOString(),
    settings: { request_timeout_ms: 1000 },
  };
  state.cursor = { last_position_id: '7', last_error_code: null, updated_at: '' };
  state.cursorReadError = false;
  state.replies = [];
  state.providerCalls = 0;
  state.windowCalls = 0;
  state.upsertCalls = 0;
  state.acks = [];
  vi.stubGlobal('fetch', vi.fn(async () => {
    state.providerCalls++;
    const reply = state.replies.shift();
    if (!reply) throw new Error('Unexpected provider call');
    const body = reply.bodyReadFailure
      ? new ReadableStream<Uint8Array>({
        pull(controller) { controller.error(new Error('synthetic body read failure')); },
      })
      : reply.body;
    return new Response(body, {
      status: reply.status,
      headers: reply.retryAfter ? { 'Retry-After': reply.retryAfter } : {},
    });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function invoke() {
  if (!state.handler) throw new Error('Generated handler not loaded');
  const response = await state.handler(new Request('https://edge.invalid/ssx-sync-rule-violations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-agvlog-cron-secret': 'synthetic-cron-secret' },
    body: JSON.stringify({ integration_account_id: 'account-1' }),
  }));
  return { response, body: await response.json() as Record<string, unknown> };
}

describe('generated SSX rule violation rollback runtime', () => {
  it('retains Retry-After when the 429 response body stream fails', async () => {
    state.replies.push({ status: 429, body: '', retryAfter: '7200', bodyReadFailure: true });
    const failure = await invoke();
    expect(failure.response.status).toBe(502);
    expect(failure.body.code).toBe('rate_limited:7200');
    expect(state.cursor.last_error_code).toBe('rate_limited:7200');
    expect(state.cursor.last_position_id).toBe('7');
    expect(state.acks).toEqual([expect.objectContaining({
      _success: false, _error_code: 'rate_limited:7200', _expected_last_position_id: '7',
    })]);
    vi.setSystemTime(new Date(startAt.getTime() + 60 * 60_000));
    expect((await invoke()).body).toMatchObject({
      status: 'deferred', retry_at: new Date(startAt.getTime() + 7200_000).toISOString(),
    });
    expect(state.providerCalls).toBe(1);
    expect(state.windowCalls).toBe(1);
    expect(state.acks).toHaveLength(1);
  });

  it('writes extended cooldown from a plain-text 429 and resumes only after expiry', async () => {
    state.replies.push(
      { status: 429, body: 'Too many requests', retryAfter: '7200' },
      { status: 200, body: '[]' },
    );
    const failure = await invoke();
    expect(failure.response.status).toBe(502);
    expect(failure.body.code).toBe('rate_limited:7200');
    expect(state.cursor.last_error_code).toBe('rate_limited:7200');
    expect(state.acks).toEqual([expect.objectContaining({
      _success: false, _expected_last_position_id: '7', _end_position_id: '10',
      _error_code: 'rate_limited:7200',
    })]);
    expect(state.cursor.last_position_id).toBe('7');
    expect(state.upsertCalls).toBe(0);

    vi.setSystemTime(new Date(startAt.getTime() + 60 * 60_000));
    const deferred = await invoke();
    expect(deferred.response.status).toBe(200);
    expect(deferred.body).toMatchObject({
      status: 'deferred', reason: 'rate_limited_backoff', requests: 0,
      retry_at: new Date(startAt.getTime() + 7200_000).toISOString(),
    });
    expect(state.providerCalls).toBe(1);
    expect(state.windowCalls).toBe(1);
    expect(state.acks).toHaveLength(1);
    expect(state.cursor.last_position_id).toBe('7');

    vi.setSystemTime(new Date(startAt.getTime() + 7200_000 + 1000));
    const success = await invoke();
    expect(success.body).toMatchObject({ success: true, cursor_advanced: true, requests: 1 });
    expect(state.providerCalls).toBe(2);
    expect(state.upsertCalls).toBe(1);
    expect(state.cursor.last_position_id).toBe('10');
    expect(state.cursor.last_error_code).toBeNull();
  });

  it('preserves the legacy 900-second cooldown and literal for a short Retry-After', async () => {
    state.replies.push(
      { status: 429, body: '{"error":"rate limit"}', retryAfter: '120' },
      { status: 200, body: '[]' },
    );
    expect((await invoke()).body.code).toBe('rate_limited');
    expect(state.cursor.last_error_code).toBe('rate_limited');
    vi.setSystemTime(new Date(startAt.getTime() + 14 * 60_000));
    expect((await invoke()).body).toMatchObject({ status: 'deferred', requests: 0 });
    expect(state.providerCalls).toBe(1);
    expect(state.acks).toHaveLength(1);
    vi.setSystemTime(new Date(startAt.getTime() + 15 * 60_000 + 1000));
    expect((await invoke()).body).toMatchObject({ success: true, cursor_advanced: true });
    expect(state.providerCalls).toBe(2);
    expect(state.cursor.last_position_id).toBe('10');
  });

  it('honors a persisted extended cooldown without calling the provider', async () => {
    state.cursor.last_error_code = 'rate_limited:7200';
    state.cursor.updated_at = startAt.toISOString();
    vi.setSystemTime(new Date(startAt.getTime() + 60 * 60_000));
    expect((await invoke()).body).toMatchObject({
      status: 'deferred', retry_at: new Date(startAt.getTime() + 7200_000).toISOString(),
    });
    expect(state.providerCalls).toBe(0);
    expect(state.windowCalls).toBe(0);
    expect(state.acks).toHaveLength(0);
    expect(state.cursor.last_position_id).toBe('7');
  });

  it('parses an HTTP-date Retry-After through the generated SSX HTTP helper', async () => {
    state.replies.push({
      status: 429,
      body: '',
      retryAfter: new Date(startAt.getTime() + 30 * 60_000).toUTCString(),
    });
    expect((await invoke()).body.code).toBe('rate_limited:1800');
    expect(state.cursor.last_error_code).toBe('rate_limited:1800');
    vi.setSystemTime(new Date(startAt.getTime() + 20 * 60_000));
    expect((await invoke()).body).toMatchObject({
      status: 'deferred', retry_at: new Date(startAt.getTime() + 30 * 60_000).toISOString(),
    });
    expect(state.providerCalls).toBe(1);
    expect(state.acks).toHaveLength(1);
    expect(state.cursor.last_position_id).toBe('7');
  });

  it('rejects a direct request without a verified cron secret or user bearer', async () => {
    if (!state.handler) throw new Error('Generated handler not loaded');
    const response = await state.handler(new Request('https://edge.invalid/ssx-sync-rule-violations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ integration_account_id: 'account-1' }),
    }));
    expect(response.status).toBe(401);
    expect(state.providerCalls).toBe(0);
    expect(state.windowCalls).toBe(0);
    expect(state.acks).toHaveLength(0);
  });

  it('fails closed when the cursor read fails', async () => {
    state.cursorReadError = true;
    const { response, body } = await invoke();
    expect(response.status).toBe(502);
    expect(body.code).toBe('cursor_read_failed');
    expect(state.providerCalls).toBe(0);
    expect(state.windowCalls).toBe(0);
    expect(state.upsertCalls).toBe(0);
    expect(state.acks).toHaveLength(0);
    expect(state.cursor.last_position_id).toBe('7');
  });
});
