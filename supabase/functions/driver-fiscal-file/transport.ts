import { isFiscalFileHeaderValid } from '../_shared/fiscal-file-validation.ts';

export const MAX_FILE_BYTES = 10_485_760;
const MAX_WIRE_BYTES = Math.ceil(MAX_FILE_BYTES / 3) * 4 + 16_384;
export type FileFormat = 'pdf' | 'xml';
export class FileReadError extends Error {
  constructor(readonly code: string, readonly status = 502) { super(code); }
}
export type HubFileRoute = { url: string; id: string };

function httpsUrl(value: string): URL {
  let url: URL;
  try { url = new URL(value); } catch { throw new FileReadError('FILE_LOCATION_INVALID'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.hash) {
    throw new FileReadError('FILE_LOCATION_INVALID');
  }
  return url;
}

/** Only this exact Hub cache endpoint can receive an emitter credential. */
export function hubFileRoute(source: string, hubBase: string, format: FileFormat): HubFileRoute | null {
  const url = httpsUrl(source);
  const endpoint = new URL(hubBase.replace(/\/$/, '') + '/hub_documents_file');
  if (url.origin !== endpoint.origin || url.pathname !== endpoint.pathname) return null;
  const id = url.searchParams.get('id') || '';
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(id) || url.searchParams.get('kind') !== format
    || [...url.searchParams.keys()].some(key => !['id', 'kind'].includes(key))
    || url.searchParams.getAll('id').length !== 1 || url.searchParams.getAll('kind').length !== 1) {
    throw new FileReadError('FILE_LOCATION_INVALID');
  }
  endpoint.searchParams.set('id', id);
  endpoint.searchParams.set('kind', format);
  return { url: endpoint.toString(), id };
}

function externalFileUrl(source: string, allowedOrigins: readonly string[]): string {
  const url = httpsUrl(source);
  // No API credentials in locations. Temporary storage signatures remain server-side.
  if ([...url.searchParams.keys()].some(key => /^(?:token|access_token|api_?key|authorization|password|secret)$/i.test(key))
    || !allowedOrigins.some(origin => origin === url.origin)) {
    throw new FileReadError('FILE_ORIGIN_NOT_ALLOWED');
  }
  return url.toString();
}

async function boundedBytes(response: Response): Promise<Uint8Array> {
  if (Number(response.headers.get('content-length')) > MAX_WIRE_BYTES) {
    await response.body?.cancel();
    throw new FileReadError('FILE_TOO_LARGE');
  }
  const reader = response.body?.getReader();
  if (!reader) throw new FileReadError('FILE_EMPTY');
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const next = await reader.read();
      if (next.done) break;
      length += next.value.byteLength;
      if (length > MAX_WIRE_BYTES) throw new FileReadError('FILE_TOO_LARGE');
      chunks.push(next.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; }
  return bytes;
}

export function checkedFileBytes(bytes: Uint8Array, format: FileFormat): Uint8Array {
  if (bytes.byteLength > MAX_FILE_BYTES) throw new FileReadError('FILE_TOO_LARGE');
  if (!isFiscalFileHeaderValid(bytes, format)) throw new FileReadError('FILE_CONTENT_INVALID');
  return bytes;
}

export async function readStoredFiscalFile(options: {
  url: string; format: FileFormat; hubRoute: HubFileRoute | null; token?: string;
  allowedOrigins: readonly string[]; apiVersion: string; fetcher?: typeof fetch; timeoutMs?: number;
}): Promise<Uint8Array> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeoutMs ?? 15_000);
  const fetcher = options.fetcher ?? fetch;
  const checked = (bytes: Uint8Array) => {
    if (options.token && new TextDecoder().decode(bytes).includes(options.token)) {
      throw new FileReadError('FILE_CONTENT_INVALID');
    }
    return checkedFileBytes(bytes, options.format);
  };
  const get = async (url: string, token?: string) => {
    if (options.token && decodeURIComponent(url).includes(options.token)) {
      throw new FileReadError('FILE_LOCATION_INVALID');
    }
    const response = await fetcher(url, {
      method: 'GET', redirect: 'error', cache: 'no-store', signal: controller.signal,
      headers: token ? { Authorization: 'Bearer ' + token, 'X-HubFiscal-Api-Version': options.apiVersion } : {},
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new FileReadError(response.status === 404 ? 'FILE_NOT_AVAILABLE' : 'FILE_UPSTREAM_UNAVAILABLE', response.status === 404 ? 404 : 502);
    }
    return response;
  };
  try {
    if (options.hubRoute && !options.token) throw new FileReadError('FILE_CREDENTIAL_UNAVAILABLE', 503);
    const url = options.hubRoute?.url ?? externalFileUrl(options.url, options.allowedOrigins);
    const response = await get(url, options.hubRoute ? options.token : undefined);
    const bytes = await boundedBytes(response);
    if (!(response.headers.get('content-type') || '').toLowerCase().includes('application/json')) {
      return checked(bytes);
    }
    // Hub cache may wrap already-stored bytes in JSON; no on-demand delivery or emission.
    let body: Record<string, unknown>;
    try { body = JSON.parse(new TextDecoder().decode(bytes)); } catch { throw new FileReadError('FILE_CONTENT_INVALID'); }
    if (!body || typeof body !== 'object' || Array.isArray(body) || body.success === false) throw new FileReadError('FILE_CONTENT_INVALID');
    const document = body.document && typeof body.document === 'object' ? body.document as Record<string, unknown> : {};
    const base64 = body.base64 ?? body.content ?? document.base64;
    if (typeof base64 === 'string') {
      const clean = base64.replace(/^data:[^,]{1,100},/, '').replace(/\s/g, '');
      if (clean.length > Math.ceil(MAX_FILE_BYTES / 3) * 4) throw new FileReadError('FILE_TOO_LARGE');
      let decoded: Uint8Array;
      try { decoded = Uint8Array.from(atob(clean), char => char.charCodeAt(0)); }
      catch { throw new FileReadError('FILE_CONTENT_INVALID'); }
      return checked(decoded);
    }
    const followUrl = body.url ?? body.fileUrl ?? document.url;
    if (typeof followUrl !== 'string') throw new FileReadError('FILE_CONTENT_INVALID');
    // A returned storage URL is fetched only from configured origins, always without Hub credentials.
    const follow = await get(externalFileUrl(followUrl, options.allowedOrigins));
    return checked(await boundedBytes(follow));
  } catch (error) {
    if (error instanceof FileReadError) throw error;
    throw new FileReadError(controller.signal.aborted ? 'FILE_TIMEOUT' : 'FILE_UPSTREAM_UNAVAILABLE', controller.signal.aborted ? 504 : 502);
  } finally { clearTimeout(timer); }
}
