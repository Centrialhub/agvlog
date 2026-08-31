// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';

const preview = 'https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site';
const vercel = 'https://agvlogistica.vercel.app';
const production = 'https://agvlog.lovable.app';
async function loadCors(env: Record<string, string> = {}) {
  vi.resetModules();
  vi.stubGlobal('Deno', { env: { get: (key: string) => env[key] } });
  const modulePath = '../../supabase/functions/_shared/fiscal-cors.ts';
  const module = await import(modulePath);
  return module.withFiscalCors as (handler: (request: Request) => Response | Promise<Response>) => (request: Request) => Promise<Response>;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('fiscal browser access without bypassing authentication', () => {
  it.each([preview, production, vercel])('allows preflight and exposes authentication errors to %s', async origin => {
    const withCors = await loadCors();
    const handler = vi.fn(async (req: Request) => new Response(req.method === 'OPTIONS' ? 'ok' : 'unauthorized', {
      status: req.method === 'OPTIONS' ? 200 : 401,
      headers: { 'Access-Control-Allow-Origin': production, Vary: 'Accept-Encoding', 'X-Trace': 'retained' },
    }));
    const wrapped = withCors(handler);
    for (const method of ['OPTIONS', 'POST']) {
      const response = await wrapped(new Request('https://edge.test', { method, headers: { Origin: origin } }));
      expect(response.status).toBe(method === 'OPTIONS' ? 200 : 401);
      expect(response.headers.get('Access-Control-Allow-Origin')).toBe(origin);
      expect(response.headers.get('Access-Control-Allow-Headers')).toContain('authorization');
      expect(response.headers.get('Vary')).toBe('Accept-Encoding, Origin');
      expect(response.headers.get('X-Trace')).toBe('retained');
      expect(await response.text()).toBe(method === 'OPTIONS' ? 'ok' : 'unauthorized');
    }
    expect(handler).toHaveBeenCalledTimes(2);
  });
  it.each(['https://evil.test', 'https://another.vercel.app', vercel + '.evil.test', 'http://agvlogistica.vercel.app', vercel + '/nfse', preview + '.evil.test', 'https://another.veituma.chatgpt.site', preview + '/cte-hub', 'null', ''])('rejects %s before dispatch', async origin => {
    const withCors = await loadCors();
    const dispatch = vi.fn();
    const response = await withCors(dispatch)(new Request('https://edge.test', { method: 'POST', headers: { Origin: origin } }));
    expect(response.status).toBe(403);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
    expect(dispatch).not.toHaveBeenCalled();
  });
  it('preserves server-to-server authentication without advertising a browser origin', async () => {
    const withCors = await loadCors();
    const authenticate = vi.fn(async () => new Response('unauthorized', { status: 401, headers: { 'Access-Control-Allow-Origin': production } }));
    const response = await withCors(authenticate)(new Request('https://edge.test', { method: 'POST' }));
    expect(authenticate).toHaveBeenCalledOnce();
    expect(response.status).toBe(401);
    expect(response.headers.has('Access-Control-Allow-Origin')).toBe(false);
  });
  it('can retire the preview explicitly without removing production', async () => {
    const withCors = await loadCors({ AGVLOG_FISCAL_PREVIEW_ORIGINS: '' });
    const handler = vi.fn(async () => new Response('ok'));
    expect((await withCors(handler)(new Request('https://edge.test', { headers: { Origin: preview } }))).status).toBe(403);
    expect((await withCors(handler)(new Request('https://edge.test', { headers: { Origin: production } }))).status).toBe(200);
    expect((await withCors(handler)(new Request('https://edge.test', { headers: { Origin: vercel } }))).status).toBe(200);
  });
  it('only accepts exact HTTPS entries from explicit preview configuration', async () => {
    const withCors = await loadCors({ AGVLOG_FISCAL_PREVIEW_ORIGINS: 'https://approved.test,https://bad.test/path,http://insecure.test,*,null' });
    const handler = vi.fn(async () => new Response('ok'));
    for (const origin of ['https://approved.test', 'https://bad.test', 'http://insecure.test', preview]) {
      expect((await withCors(handler)(new Request('https://edge.test', { headers: { Origin: origin } }))).status).toBe(origin === 'https://approved.test' ? 200 : 403);
    }
  });
  it('fails closed if the primary origin configuration is invalid', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const withCors = await loadCors({ AGVLOG_APP_ORIGIN: '*' });
    const handler = vi.fn();
    expect((await withCors(handler)(new Request('https://edge.test', { headers: { Origin: preview } }))).status).toBe(403);
    expect(handler).not.toHaveBeenCalled();
  });
});
