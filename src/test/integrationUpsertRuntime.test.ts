// @vitest-environment node
import { beforeAll, describe, expect, it, vi } from 'vitest';

const state = vi.hoisted(() => ({
  handler: null as null | ((request: Request) => Promise<Response>),
  encryptionKey: 'invalid-key',
}));

vi.mock('@supabase/supabase-js', () => ({ createClient: vi.fn() }));

beforeAll(async () => {
  vi.stubGlobal('Deno', {
    env: { get: (name: string) => name === 'AGVLOG_ENCRYPTION_KEY'
      ? state.encryptionKey
      : name === 'AGVLOG_APP_ORIGIN' ? 'https://app.example.test' : 'configured' },
    serve: (handler: typeof state.handler) => { state.handler = handler; },
  });
  const upsertPath = '../../supabase/functions/agvlog-integration-upsert/index.ts';
  await import(upsertPath);
});

const call = (method: string) => {
  if (!state.handler) throw new Error('handler_not_loaded');
  return state.handler(new Request('https://edge.example.test', {
    method,
    headers: method === 'POST' ? { Authorization: 'Bearer test' } : undefined,
    body: method === 'POST' ? '{}' : undefined,
  }));
};

describe('agvlog-integration-upsert HTTP boundary', () => {
  it('allows CORS preflight but rejects every non-POST operation', async () => {
    expect((await call('OPTIONS')).status).toBe(200);
    for (const method of ['GET', 'PUT', 'PATCH', 'DELETE']) {
      const response = await call(method);
      expect(response.status).toBe(405);
      expect(response.headers.get('Allow')).toBe('POST, OPTIONS');
    }
  });

  it('fails closed before encryption when the configured key is not exact AES-256 hex', async () => {
    const response = await call('POST');
    expect(response.status).toBe(500);
    await expect(response.json()).resolves.toEqual({
      error: 'AGVLOG_ENCRYPTION_KEY must be exactly 64 hexadecimal characters',
    });
  });
});
