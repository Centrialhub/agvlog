import { appOrigin, corsHeaders } from './cors.ts';

// Explicitly approved billing origins. Never trust an entire hosting domain:
// other customers can publish there.
const BILLING_PRODUCTION_ORIGIN = 'https://agvlogistica.vercel.app';
// Remove this preview when its deployment is retired.
const BILLING_PREVIEW_ORIGIN = 'https://agvlog-preview-thomaz-20260831.veituma.chatgpt.site';

function allowedFiscalOrigins(): Set<string> {
  // An invalid primary configuration must remain fail-closed.
  if (!appOrigin) return new Set();
  const allowed = new Set([appOrigin, BILLING_PRODUCTION_ORIGIN]);
  const configured = Deno.env.get('AGVLOG_FISCAL_PREVIEW_ORIGINS') ?? BILLING_PREVIEW_ORIGIN;
  for (const candidate of configured.split(',')) {
    const origin = candidate.trim();
    if (!origin) continue;
    try {
      const url = new URL(origin);
      if (url.protocol === 'https:' && url.origin === origin) allowed.add(origin);
    } catch {
      // Invalid entries never grant browser access.
    }
  }
  return allowed;
}

const allowedOrigins = allowedFiscalOrigins();

/** Apply the same exact-origin policy to preflight, success and error responses.
 * This supplements (and never replaces) each handler's JWT/tenant checks.
 * Requests without Origin retain the existing server/cron authentication.
 */
export function withFiscalCors(handler: (request: Request) => Response | Promise<Response>) {
  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('Origin');
    const headers = new Headers(corsHeaders);
    headers.delete('Access-Control-Allow-Origin');
    headers.set('Access-Control-Max-Age', '600');
    if (origin !== null && !allowedOrigins.has(origin)) {
      headers.set('Content-Type', 'application/json');
      return new Response(JSON.stringify({ success: false, error: { code: 'ORIGIN_NOT_ALLOWED' } }), { status: 403, headers });
    }
    if (origin) headers.set('Access-Control-Allow-Origin', origin);
    const response = await handler(request);
    const responseHeaders = new Headers(response.headers);
    responseHeaders.delete('Access-Control-Allow-Origin');
    // Preserve other cache dimensions while adding the request Origin dimension.
    const vary = new Set((responseHeaders.get('Vary') || '').split(',').map(value => value.trim()).filter(Boolean));
    vary.add('Origin');
    headers.forEach((value, key) => responseHeaders.set(key, value));
    responseHeaders.set('Vary', [...vary].join(', '));
    return new Response(response.body, { status: response.status, statusText: response.statusText, headers: responseHeaders });
  };
}
