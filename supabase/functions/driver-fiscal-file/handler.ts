import type { SupabaseClient } from '@supabase/supabase-js';
import { requireActiveTenant } from '../_shared/active-tenant.ts';
import { requireIntegrationCapability } from '../_shared/capabilities.ts';
import { fiscalHubBaseUrl } from '../_shared/fiscal-transport.ts';
import { driverFileCredential } from './credentials.ts';
import { checkedFileBytes, FileReadError, hubFileRoute, readStoredFiscalFile } from './transport.ts';

type FileRequest = { tenant_id: string; load_id: string; kind: 'cte' | 'nfse'; document_id: string; format: 'pdf' | 'xml' };
type StoredFile = { filename: string } & ({ source: 'url'; url: string } | { source: 'inline'; content: string });
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function fileRequest(body: unknown): FileRequest {
  const value = body as FileRequest;
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).sort().join(',') !== 'document_id,format,kind,load_id,tenant_id'
    || ![value.tenant_id, value.load_id, value.document_id].every(id => typeof id === 'string' && uuid.test(id))
    || !['cte', 'nfse'].includes(value.kind) || !['pdf', 'xml'].includes(value.format)) {
    throw new FileReadError('FILE_REQUEST_INVALID', 400);
  }
  return value;
}
function storedFile(raw: unknown, request: FileRequest): StoredFile {
  const file = raw as Record<string, unknown> | null;
  if (!file || file.load_id !== request.load_id || file.kind !== request.kind
    || file.document_id !== request.document_id || file.format !== request.format
    || typeof file.filename !== 'string' || file.filename.length > 180
    || !/^[A-Za-z0-9._-]{1,176}\.(?:pdf|xml)$/.test(file.filename)
    || !file.filename.endsWith('.' + request.format)) throw new FileReadError('FILE_ACK_INVALID', 503);
  if (file.source === 'url' && typeof file.url === 'string' && file.url.length <= 4096 && file.content == null) {
    return { filename: file.filename, source: 'url', url: file.url };
  }
  if (file.source === 'inline' && request.format === 'xml' && typeof file.content === 'string' && file.content.length <= 10_485_760 && file.url == null) {
    return { filename: file.filename, source: 'inline', content: file.content };
  }
  throw new FileReadError('FILE_ACK_INVALID', 503);
}

export async function handleDriverFiscalFile(req: Request, caller: SupabaseClient, admin: SupabaseClient,
  headers: Record<string, string>, options: { env: (name: string) => string | undefined; fetcher?: typeof fetch; timeoutMs?: number },
): Promise<Response> {
  const responseHeaders = { ...headers, 'Cache-Control': 'private, no-store', 'X-Content-Type-Options': 'nosniff' };
  const json = (status: number, code: string) => new Response(JSON.stringify({ error: { code } }), {
    status, headers: { ...responseHeaders, 'Content-Type': 'application/json' },
  });
  try {
    if (req.method !== 'POST') return json(405, 'METHOD_NOT_ALLOWED');
    if (!/^Bearer \S+$/i.test(req.headers.get('authorization') || '')) return json(401, 'UNAUTHENTICATED');
    const { data, error } = await caller.auth.getUser();
    if (error || !data.user) return json(401, 'UNAUTHENTICATED');
    const userId = data.user.id;
    if (Number(req.headers.get('content-length')) > 4096) return json(400, 'FILE_REQUEST_INVALID');
    const text = await req.text();
    if (text.length > 4096) return json(400, 'FILE_REQUEST_INVALID');
    let body: unknown;
    try { body = JSON.parse(text); } catch { return json(400, 'FILE_REQUEST_INVALID'); }
    const request = fileRequest(body);
    const contextError = requireActiveTenant(req, request.tenant_id, responseHeaders);
    if (contextError) return contextError;

    const authorize = async () => {
      const { data: file, error: rpcError } = await caller.rpc('driver_get_load_fiscal_file', {
        _tenant_id: request.tenant_id, _load_id: request.load_id, _document_kind: request.kind,
        _document_id: request.document_id, _format: request.format,
      });
      if (rpcError) throw new FileReadError('FILE_ACCESS_DENIED', rpcError.code === '42501' ? 403 : 503);
      return storedFile(file, request);
    };
    const file = await authorize(); // Never use service_role for driver authorization.
    let bytes: Uint8Array;
    let recheckCredential: (() => Promise<void>) | undefined;
    if (file.source === 'inline') {
      bytes = checkedFileBytes(new TextEncoder().encode(file.content), request.format);
    } else {
      const capability = await requireIntegrationCapability(admin, request.tenant_id, 'fiscal');
      if (capability) return json(capability.status, 'FISCAL_INTEGRATION_UNAVAILABLE');
      const hubBase = fiscalHubBaseUrl(options.env('HUB_FISCAL_BASE_URL'));
      const route = hubFileRoute(file.url, hubBase, request.format);
      const credential = route ? await driverFileCredential(admin, request, route.id, hubBase, options.env) : undefined;
      const token = credential?.token;
      if (route && credential) recheckCredential = async () => {
        const latestCredential = await driverFileCredential(admin, request, route.id, hubBase, options.env);
        if (latestCredential.token !== credential.token || latestCredential.bindingFingerprint !== credential.bindingFingerprint) {
          throw new FileReadError('FILE_CONTEXT_CHANGED', 409);
        }
      };
      const allowedOrigins = (options.env('AGVLOG_DRIVER_FISCAL_FILE_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean);
      bytes = await readStoredFiscalFile({
        url: file.url, format: request.format, hubRoute: route, token, allowedOrigins,
        apiVersion: options.env('HUB_FISCAL_API_VERSION') || '2026-08-27', fetcher: options.fetcher, timeoutMs: options.timeoutMs,
      });
    }
    // No bearer URL or reusable grant is minted. Recheck expiry, revocation and assignment after upstream I/O.
    const current = await caller.auth.getUser();
    if (current.error || current.data.user?.id !== userId) return json(401, 'UNAUTHENTICATED');
    const latest = await authorize();
    if (JSON.stringify(latest) !== JSON.stringify(file)) return json(409, 'FILE_CONTEXT_CHANGED');
    if (file.source === 'url') {
      const capability = await requireIntegrationCapability(admin, request.tenant_id, 'fiscal');
      if (capability) return json(capability.status, 'FISCAL_INTEGRATION_UNAVAILABLE');
    }
    await recheckCredential?.();
    return new Response(bytes, { status: 200, headers: {
      ...responseHeaders, 'Content-Type': request.format === 'pdf' ? 'application/pdf' : 'application/xml;charset=utf-8',
      'Content-Disposition': 'attachment; filename="' + file.filename + '"',
    } });
  } catch (error) {
    return error instanceof FileReadError ? json(error.status, error.code) : json(503, 'FILE_UNAVAILABLE');
  }
}
