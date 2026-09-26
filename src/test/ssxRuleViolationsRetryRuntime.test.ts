// @vitest-environment node
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

type FetchReply = { status: number; body: string; retryAfter?: string };
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
  violations: new Map<number, Record<string, unknown>>(),
}));

vi.mock('../../supabase/functions/_shared/cron-auth.ts', () => ({
  isCronRequest: vi.fn().mockResolvedValue(true),
}));
vi.mock('../../supabase/functions/_shared/capabilities.ts', () => ({
  requireIntegrationCapability: vi.fn().mockResolvedValue(null),
}));
vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: (table: string) => {
      if (table === 'integration_logs') return {
        insert: async () => ({ error: null }),
      };
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
      if (name === 'get_ssx_rule_violation_window_v1') {
        state.windowCalls++;
        return { data: {
          expected_last_position_id: state.cursor.last_position_id,
          start_position_id: '8', end_position_id: '10', should_poll: true,
        }, error: null };
      }
      if (name === 'upsert_ssx_rule_violations_v1') {
        state.upsertCalls++;
        const items = args._items as Array<Record<string, unknown>>;
        for (const item of items) {
          state.violations.set(Number(item.provider_violation_id), item);
        }
        return { data: items.length, error: null };
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
const oneViolation = [{ IdRuleViolation: 101, InitialDate: '2026-09-25T12:00:00.000Z' }];

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (key: string) => ({
      SUPABASE_URL: 'https://db.invalid',
      SUPABASE_SERVICE_ROLE_KEY: 'service',
      SUPABASE_ANON_KEY: 'anon',
    } as Record<string, string>)[key] },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  // Variable import keeps Deno-only Edge code outside the frontend typecheck.
  const handlerPath = '../../supabase/functions/ssx-sync-rule-violations/index.ts';
  await import(handlerPath);
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
  state.violations.clear();
  vi.stubGlobal('fetch', vi.fn(async () => {
    state.providerCalls++;
    const reply = state.replies.shift();
    if (!reply) throw new Error('Unexpected provider call');
    return new Response(reply.body, {
      status: reply.status,
      headers: reply.retryAfter ? { 'Retry-After': reply.retryAfter } : {},
    });
  }));
  vi.spyOn(console, 'error').mockImplementation(() => undefined);
  vi.spyOn(console, 'log').mockImplementation(() => undefined);
});
afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

async function invoke() {
  if (!state.handler) throw new Error('Handler not loaded');
  const response = await state.handler(new Request('https://edge.invalid/ssx-sync-rule-violations', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ integration_account_id: 'account-1' }),
  }));
  return { response, body: await response.json() as Record<string, unknown> };
}

describe('SSX rule violation retry and cursor contract', () => {
  it('honors a long Retry-After even when the 429 body is not JSON, then replays idempotently', async () => {
    state.replies.push(
      { status: 429, body: 'Too many requests', retryAfter: '7200' },
      { status: 200, body: JSON.stringify(oneViolation) },
      { status: 200, body: JSON.stringify(oneViolation) },
    );

    const failure = await invoke();
    expect(failure.response.status).toBe(502);
    expect(failure.body.code).toBe('rate_limited:7200');
    expect(state.cursor.last_position_id).toBe('7');
    expect(state.cursor.last_error_code).toBe('rate_limited:7200');
    expect(state.acks[0]).toMatchObject({ _success: false, _expected_last_position_id: '7' });
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

    vi.setSystemTime(new Date(startAt.getTime() + 7200_000 + 1000));
    const success = await invoke();
    expect(success.body).toMatchObject({ success: true, cursor_advanced: true, upserted: 1 });
    expect(state.cursor.last_position_id).toBe('10');
    expect(state.cursor.last_error_code).toBeNull();
    expect(state.violations.size).toBe(1);

    const replay = await invoke();
    expect(replay.body).toMatchObject({ success: true, cursor_advanced: true });
    expect(state.cursor.last_position_id).toBe('10');
    expect(state.violations.size).toBe(1);
  });

  it.each([undefined, '120'])('keeps the published 15-minute cooldown for Retry-After %s', async (retryAfter) => {
    state.replies.push(
      { status: 429, body: '{"error":"rate limit"}', retryAfter },
      { status: 200, body: '[]' },
    );
    expect((await invoke()).body.code).toBe('rate_limited');
    expect(state.cursor.last_position_id).toBe('7');
    vi.setSystemTime(new Date(startAt.getTime() + 14 * 60_000));
    expect((await invoke()).body.status).toBe('deferred');
    expect(state.providerCalls).toBe(1);
    vi.setSystemTime(new Date(startAt.getTime() + 15 * 60_000 + 1000));
    expect((await invoke()).body).toMatchObject({ success: true, cursor_advanced: true });
    expect(state.providerCalls).toBe(2);
  });

  it('accepts an HTTP-date Retry-After through the real SSX HTTP helper', async () => {
    state.replies.push({
      status: 429, body: '',
      retryAfter: new Date(startAt.getTime() + 30 * 60_000).toUTCString(),
    });
    expect((await invoke()).body.code).toBe('rate_limited:1800');
    vi.setSystemTime(new Date(startAt.getTime() + 20 * 60_000));
    expect((await invoke()).body.status).toBe('deferred');
    expect(state.providerCalls).toBe(1);
    expect(state.cursor.last_position_id).toBe('7');
  });

  it('fails closed if the cursor cannot be read', async () => {
    state.cursorReadError = true;
    const { response, body } = await invoke();
    expect(response.status).toBe(502);
    expect(body.code).toBe('cursor_read_failed');
    expect(state.providerCalls).toBe(0);
    expect(state.windowCalls).toBe(0);
    expect(state.acks).toHaveLength(0);
    expect(state.cursor.last_position_id).toBe('7');
  });
});
