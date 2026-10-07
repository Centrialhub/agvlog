// @vitest-environment node
import type { SupabaseClient } from '@supabase/supabase-js';
import { beforeAll, beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { encryptFiscalCredential } from '../../supabase/functions/_shared/fiscal-credential-crypto';
import { hubFileRoute, readStoredFiscalFile, MAX_FILE_BYTES } from '../../supabase/functions/driver-fiscal-file/transport';
import { driverFileCredential } from '../../supabase/functions/driver-fiscal-file/credentials';

const ids = { tenant: '20000000-0000-4000-8000-000000000001', load: '80000000-0000-4000-8000-000000000001',
  document: 'a0000000-0000-4000-8000-000000000001', actor: '10000000-0000-4000-8000-000000000001', emitter: '60000000-0000-4000-8000-000000000001' };
const other = '90000000-0000-4000-8000-000000000002';
const hubBase = 'https://hub.example.test/functions/v1';
const hubUrl = hubBase + '/hub_documents_file?id=stored-329&kind=pdf';
const secret = 'SYNTHETIC-HUB-CREDENTIAL-NEVER-IN-CLIENT';
const auth = 'fixture.' + Buffer.from(JSON.stringify({ active_tenant_id: ids.tenant })).toString('base64url') + '.signature';
const payload = { tenant_id: ids.tenant, load_id: ids.load, kind: 'cte', document_id: ids.document, format: 'pdf' };
let handle: typeof import('../../supabase/functions/driver-fiscal-file/handler').handleDriverFiscalFile;
let expired = false, revoked = false, capability = true;
let descriptor: Record<string, unknown>;
let tables: Record<string, Record<string, unknown>[]>;
let calls: Array<{ name: string; args: Record<string, unknown>; admin: boolean }>;
let reads: string[];
const env: Record<string, string> = { HUB_FISCAL_BASE_URL: hubBase, TEST_TOKEN: secret, AGVLOG_ENCRYPTION_KEY: 'a1'.repeat(32) };
const fetcher = vi.fn<typeof fetch>();

const caller = {
  auth: { getUser: async () => ({ data: { user: expired ? null : { id: ids.actor } }, error: expired ? { code: 'expired' } : null }) },
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args, admin: false });
    if (revoked || args._tenant_id !== ids.tenant || args._load_id !== ids.load || args._document_id !== ids.document
      || args._document_kind !== descriptor.kind || args._format !== descriptor.format) {
      return { data: null, error: { code: '42501', message: 'not_authorized' } };
    }
    return { data: descriptor, error: null };
  },
} as unknown as SupabaseClient;
const admin = {
  rpc: async (name: string, args: Record<string, unknown>) => {
    calls.push({ name, args, admin: true });
    return { data: null, error: capability ? null : { code: '42501', message: 'integration_capability_disabled' } };
  },
  from: (table: string) => {
    reads.push(table);
    const filters: Array<[string, unknown]> = [];
    let single = false, max = Infinity;
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      limit: (limit: number) => { max = limit; return query; },
      maybeSingle: () => { single = true; return query; },
      then: (resolve: (value: unknown) => unknown) => {
        const rows = (tables[table] || []).filter(row => filters.every(([key, value]) => row[key] === value)).slice(0, max);
        return Promise.resolve({ data: single ? rows[0] ?? null : rows, error: null }).then(resolve);
      },
    };
    return query;
  },
} as unknown as SupabaseClient;

function request(body: unknown = payload, headers: Record<string, string> = {}, method = 'POST') {
  return new Request('https://agvlog.example.test/functions/v1/driver-fiscal-file', { method,
    headers: { Authorization: 'Bearer ' + auth, 'x-agvlog-tenant-id': ids.tenant, ...headers },
    ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
  });
}
function run(req = request(), timeoutMs?: number) {
  return handle(req, caller, admin, {}, { env: name => env[name], fetcher, timeoutMs });
}
async function errorCode(response: Response) { return (await response.json()).error.code as string; }

beforeAll(async () => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
  handle = (await import('../../supabase/functions/driver-fiscal-file/handler')).handleDriverFiscalFile;
});
beforeEach(() => {
  expired = false; revoked = false; capability = true; calls = []; reads = [];
  delete env.AGVLOG_DRIVER_FISCAL_FILE_ORIGINS;
  descriptor = { load_id: ids.load, kind: 'cte', document_id: ids.document, format: 'pdf', filename: 'cte-329.pdf', source: 'url', url: hubUrl };
  tables = {
    cte_documents: [{ id: ids.document, tenant_id: ids.tenant, emitter_id: ids.emitter }],
    nfse_documents: [{ id: ids.document, tenant_id: ids.tenant, emitter_id: ids.emitter }],
    hub_fiscal_emissions: [{ id: 'b0000000-0000-4000-8000-000000000001', tenant_id: ids.tenant, cte_document_id: ids.document, nfse_document_id: ids.document,
      doc_type: 'cte', emitter_id: ids.emitter, hub_document_id: 'stored-329', environment: 'homologation' }],
    tenant_emitters: [{ id: ids.emitter, tenant_id: ids.tenant }],
    hub_fiscal_credentials: [{ id: 'c0000000-0000-4000-8000-000000000001', tenant_id: ids.tenant, emitter_id: ids.emitter, doc_scope: 'cte', environment: 'homologation', enabled: true, secret_name: 'TEST_TOKEN' }],
  };
  fetcher.mockReset();
  fetcher.mockResolvedValue(new Response('%PDF-1.7\nsynthetic CT-e329 fixture', { headers: { 'Content-Type': 'application/pdf' } }));
});
afterEach(() => vi.restoreAllMocks());

describe('F05 read-only Edge and real transport helpers with synthetic Auth/DB/Hub', () => {
  it('authenticates private Hub GET server-side and returns only PDF bytes, never a provider URL or credential', async () => {
    const log = vi.spyOn(console, 'log'), warn = vi.spyOn(console, 'warn'), error = vi.spyOn(console, 'error');
    const response = await run();
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/pdf');
    expect(response.headers.get('Content-Disposition')).toBe('attachment; filename="cte-329.pdf"');
    expect(response.headers.get('Cache-Control')).toBe('private, no-store');
    expect(response.headers.get('X-Content-Type-Options')).toBe('nosniff');
    expect(await response.text()).toBe('%PDF-1.7\nsynthetic CT-e329 fixture');
    expect(fetcher).toHaveBeenCalledTimes(1);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe(hubUrl);
    expect(String(url)).not.toContain(secret);
    expect(init).toMatchObject({ method: 'GET', redirect: 'error', cache: 'no-store',
      headers: { Authorization: 'Bearer ' + secret, 'X-HubFiscal-Api-Version': '2026-08-27' } });
    expect(JSON.stringify([...response.headers])).not.toContain(secret);
    expect(log).not.toHaveBeenCalled(); expect(warn).not.toHaveBeenCalled(); expect(error).not.toHaveBeenCalled();
    const driverCalls = calls.filter(call => call.name === 'driver_get_load_fiscal_file');
    expect(driverCalls).toHaveLength(2); expect(driverCalls.every(call => !call.admin)).toBe(true);
    expect(calls.filter(call => call.admin).map(call => call.name)).toEqual(['assert_tenant_integration_capability_v1', 'assert_tenant_integration_capability_v1']);
  });

  it.each(['cte', 'nfse'])('reads private %s XML base64 with the exact scoped credential', async kind => {
    descriptor = { ...descriptor, kind, format: 'xml', filename: kind + '-329.xml', url: hubUrl.replace('kind=pdf', 'kind=xml') };
    tables.hub_fiscal_emissions[0].doc_type = kind;
    tables.hub_fiscal_credentials[0].doc_scope = kind;
    tables.hub_fiscal_credentials[0].secret_ciphertext = await encryptFiscalCredential(secret, env.AGVLOG_ENCRYPTION_KEY);
    fetcher.mockResolvedValue(new Response(JSON.stringify({ document: { base64: Buffer.from('<cteProc><CTe>fixture329</CTe></cteProc>').toString('base64') } }), { headers: { 'Content-Type': 'application/json' } }));
    const response = await run(request({ ...payload, kind, format: 'xml' }));
    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('application/xml;charset=utf-8');
    expect(await response.text()).toContain('<CTe>fixture329</CTe>');
  });

  it('keeps inline XML available without Hub or capability calls', async () => {
    descriptor = { ...descriptor, source: 'inline', url: null, content: '<cteProc/>', format: 'xml', filename: 'cte-329.xml' };
    capability = false;
    const response = await run(request({ ...payload, format: 'xml' }));
    expect(response.status).toBe(200); expect(await response.text()).toBe('<cteProc/>');
    expect(fetcher).not.toHaveBeenCalled(); expect(reads).toEqual([]); expect(calls.every(call => !call.admin)).toBe(true);
  });

  it.each(['tenant_id', 'load_id', 'document_id'])('denies a different %s before credentials or transport', async key => {
    const response = await run(request({ ...payload, [key]: other }));
    expect([403, 409]).toContain(response.status);
    expect(reads).toEqual([]); expect(fetcher).not.toHaveBeenCalled();
  });
  it('denies unauthenticated/expired callers, forged tenant headers, and arbitrary proxy actions', async () => {
    expect((await run(request(payload, { Authorization: '' }))).status).toBe(401);
    expired = true; expect((await run()).status).toBe(401); expired = false;
    expect((await run(request(payload, { 'x-agvlog-tenant-id': other }))).status).toBe(409);
    expect((await run(request({ ...payload, action: 'emit', token: secret, url: hubUrl }))).status).toBe(400);
    expect((await run(request(payload, {}, 'GET'))).status).toBe(405);
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['revoked', 'expired', 'changed', 'disabled'])('discards bytes when %s during Hub fetch', async state => {
    fetcher.mockImplementation(async () => {
      if (state === 'revoked') revoked = true;
      if (state === 'expired') expired = true;
      if (state === 'changed') descriptor = { ...descriptor, filename: 'cte-other.pdf' };
      if (state === 'disabled') capability = false;
      return new Response('%PDF-1.7 synthetic');
    });
    const response = await run();
    expect(response.status).toBe(state === 'expired' ? 401 : state === 'changed' ? 409 : 403);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    expect(await response.text()).not.toContain('%PDF');
  });

  it.each(['tenant_id', 'emitter_id', 'environment', 'doc_scope', 'enabled'])('fails closed for incongruent credential %s', async key => {
    tables.hub_fiscal_credentials[0][key] = key === 'enabled' ? false : 'different';
    const response = await run();
    expect(response.status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
    expect(await errorCode(response)).toBe('FILE_CREDENTIAL_UNAVAILABLE');
  });
  it.each(['hub_document_id', 'cte_document_id', 'emitter_id', 'doc_type'])('rejects a mismatched emission %s without using a global credential', async key => {
    tables.hub_fiscal_emissions[0][key] = 'different';
    env.HUB_FISCAL_API_KEY = 'GLOBAL-MUST-NOT-BE-USED';
    expect((await run()).status).toBe(503); expect(fetcher).not.toHaveBeenCalled();
  });
  it('rejects duplicate routes/credentials and unreadable ciphertext, without secret error bodies', async () => {
    tables.hub_fiscal_emissions.push({ ...tables.hub_fiscal_emissions[0] });
    expect((await run()).status).toBe(503); tables.hub_fiscal_emissions.pop();
    tables.hub_fiscal_credentials.push({ ...tables.hub_fiscal_credentials[0] });
    expect((await run()).status).toBe(503); tables.hub_fiscal_credentials.pop();
    tables.hub_fiscal_credentials[0].secret_ciphertext = secret;
    const response = await run(); expect(response.status).toBe(503);
    expect(await response.text()).not.toContain(secret); expect(fetcher).not.toHaveBeenCalled();
  });
  it('discards an accidental credential echo even in a syntactically valid PDF', async () => {
    fetcher.mockResolvedValue(new Response('%PDF-1.7 ' + secret));
    const response = await run(); expect(response.status).toBe(502);
    expect(await response.text()).not.toContain(secret);
  });
  it('discards bytes when the credential is disabled during the download', async () => {
    fetcher.mockImplementation(async () => { tables.hub_fiscal_credentials[0].enabled = false; return new Response('%PDF-1.7 fixture'); });
    const response = await run(); expect(response.status).toBe(503);
    expect(await errorCode(response)).toBe('FILE_CREDENTIAL_UNAVAILABLE');
  });
  it('discards bytes when the local emitter binding changes during the download', async () => {
    fetcher.mockImplementation(async () => { tables.cte_documents[0].emitter_id = other; return new Response('%PDF-1.7 fixture'); });
    expect((await run()).status).toBe(503);
  });
  it.each(['cte', 'nfse'] as const)('discards a congruent emitter rebind for %s with identical token and descriptor', async kind => {
    descriptor = { ...descriptor, kind };
    tables.hub_fiscal_emissions[0].doc_type = kind;
    tables.hub_fiscal_credentials[0].doc_scope = kind;
    const originalDescriptor = structuredClone(descriptor);
    // B is fully valid in the same tenant and uses exactly the same server secret.
    tables.tenant_emitters.push({ id: other, tenant_id: ids.tenant });
    tables.hub_fiscal_credentials.push({ ...tables.hub_fiscal_credentials[0],
      id: 'c0000000-0000-4000-8000-000000000002', emitter_id: other });
    fetcher.mockImplementation(async () => {
      tables[kind === 'cte' ? 'cte_documents' : 'nfse_documents'][0].emitter_id = other;
      tables.hub_fiscal_emissions[0].emitter_id = other;
      return new Response('%PDF-1.7 stale-emitter-bytes');
    });
    const response = await run(request({ ...payload, kind }));
    expect(response.status).toBe(409);
    expect(response.headers.get('Content-Type')).toBe('application/json');
    const body = await response.text();
    expect(body).toContain('FILE_CONTEXT_CHANGED');
    expect(body).not.toContain('%PDF'); expect(body).not.toContain(secret);
    expect(descriptor).toEqual(originalDescriptor);
    expect(calls.filter(call => call.name === 'driver_get_load_fiscal_file')).toHaveLength(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][1]).toMatchObject({ method: 'GET', headers: { Authorization: 'Bearer ' + secret } });
  });
  it.each(['emission', 'credential', 'environment', 'scope'])('discards a congruent %s identity change even with the same token', async field => {
    fetcher.mockImplementation(async () => {
      if (field === 'emission') tables.hub_fiscal_emissions[0].id = other;
      if (field === 'credential') tables.hub_fiscal_credentials[0].id = other;
      if (field === 'environment') {
        tables.hub_fiscal_emissions[0].environment = 'production';
        tables.hub_fiscal_credentials[0].environment = 'production';
      }
      if (field === 'scope') tables.hub_fiscal_credentials[0].doc_scope = 'all';
      return new Response('%PDF-1.7 stale-binding-bytes');
    });
    const response = await run();
    expect(response.status).toBe(409);
    expect(await response.text()).toBe(JSON.stringify({ error: { code: 'FILE_CONTEXT_CHANGED' } }));
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('keeps the stable binding fingerprint non-secret while retaining its scoped identities', async () => {
    const first = await driverFileCredential(admin, payload as typeof payload & { kind: 'cte' }, 'stored-329', hubBase, name => env[name]);
    const second = await driverFileCredential(admin, payload as typeof payload & { kind: 'cte' }, 'stored-329', hubBase, name => env[name]);
    expect(second).toEqual(first);
    expect(first.token).toBe(secret);
    expect(first.bindingFingerprint).toContain(ids.tenant);
    expect(first.bindingFingerprint).toContain(ids.document);
    expect(first.bindingFingerprint).toContain(ids.emitter);
    expect(first.bindingFingerprint).toContain(String(tables.hub_fiscal_emissions[0].id));
    expect(first.bindingFingerprint).toContain(String(tables.hub_fiscal_credentials[0].id));
    expect(first.bindingFingerprint).not.toContain(secret);
    expect(first.bindingFingerprint).not.toContain('TEST_TOKEN');
    expect(first.bindingFingerprint).not.toContain('secret_');
  });
  it.each([401, 403, 404, 503, 302])('sanitizes Hub HTTP%s including redirects', async status => {
    fetcher.mockResolvedValue(new Response('upstream error ' + secret, { status, headers: { Location: 'https://third-party.example.test/' + secret } }));
    const response = await run();
    expect(response.status).toBe(status === 404 ? 404 : 502);
    expect(await response.text()).not.toContain(secret); expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it.each(['<html>login</html>', JSON.stringify({ code: 'UNAUTHORIZED', token: secret }), 'not a pdf'])('rejects nonfile content %s', async content => {
    fetcher.mockResolvedValue(new Response(content, { headers: { 'Content-Type': content[0] === '{' ? 'application/json' : 'text/html' } }));
    const response = await run();
    expect(response.status).toBe(502); expect(await response.text()).not.toContain(secret);
  });
  it('fails closed on oversized declared and streamed bodies', async () => {
    fetcher.mockResolvedValue(new Response('%PDF', { headers: { 'Content-Length': '20000000' } }));
    expect(await errorCode(await run())).toBe('FILE_TOO_LARGE');
    fetcher.mockResolvedValue(new Response(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array(MAX_FILE_BYTES + 5_000_000)); controller.close(); } })));
    expect(await errorCode(await run())).toBe('FILE_TOO_LARGE');
  });
  it('bounds the entire upstream body read, sanitizing timeout and network exceptions', async () => {
    fetcher.mockImplementation(async (_url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(new Error(secret)), { once: true });
    }));
    const response = await run(request(), 5);
    expect(response.status).toBe(504); expect(await errorCode(response)).toBe('FILE_TIMEOUT');
    fetcher.mockRejectedValue(new Error('URL?token=' + secret));
    const failure = await run(); expect(failure.status).toBe(502); expect(await failure.text()).not.toContain(secret);
  });
  it('requires exact Hub path/id/format and rejects credential parameters without making requests', async () => {
    for (const url of [hubUrl + '&token=' + secret, hubUrl + '&id=other', hubUrl.replace('kind=pdf', 'kind=xml')]) {
      descriptor = { ...descriptor, url };
      expect((await run()).status).toBe(502);
    }
    expect(fetcher).not.toHaveBeenCalled();
    expect(() => hubFileRoute('http://localhost/private', hubBase, 'pdf')).toThrow();
  });
  it('requires an explicit storage origin and never sends the Hub token to the follow-up URL', async () => {
    const storageUrl = 'https://files.example.test/stored/329.pdf?signature=temporary-fixture';
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ url: storageUrl }), { headers: { 'Content-Type': 'application/json' } }));
    expect(await errorCode(await run())).toBe('FILE_ORIGIN_NOT_ALLOWED'); expect(fetcher).toHaveBeenCalledTimes(1);
    env.AGVLOG_DRIVER_FISCAL_FILE_ORIGINS = 'https://files.example.test';
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ url: storageUrl }), { headers: { 'Content-Type': 'application/json' } }));
    fetcher.mockResolvedValueOnce(new Response('%PDF-1.7 storage fixture'));
    expect((await run()).status).toBe(200);
    expect(fetcher.mock.calls[2][1]?.headers).toEqual({});
    fetcher.mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://files.example.test/private?signature=' + encodeURIComponent(secret) }), { headers: { 'Content-Type': 'application/json' } }));
    expect(await errorCode(await run())).toBe('FILE_LOCATION_INVALID');
    descriptor = { ...descriptor, url: storageUrl };
    fetcher.mockResolvedValueOnce(new Response('%PDF-1.7 stored external fixture'));
    expect((await run()).status).toBe(200); expect(fetcher.mock.calls[4][1]?.headers).toEqual({});
  });
  it('does not forward credentials on any external URL or accept unlisted targets', async () => {
    const route = hubFileRoute(hubUrl, hubBase, 'pdf')!;
    await expect(readStoredFiscalFile({ url: hubUrl, format: 'pdf', hubRoute: route, allowedOrigins: [], apiVersion: 'fixture', fetcher })).rejects.toThrow('FILE_CREDENTIAL_UNAVAILABLE');
    descriptor = { ...descriptor, url: 'https://third-party.example.test/private' };
    expect((await run()).status).toBe(502); expect(fetcher).not.toHaveBeenCalled();
  });
});
