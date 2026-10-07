// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { downloadDriverFiscalFile } from '@/lib/driver/fiscalFileDownload';
import { setActiveTenantId } from '@/lib/tenant/activeTenantContext';

const mock = vi.hoisted(() => ({ getSession: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mock.getSession } } }));
const request = { tenantId: 'tenant-fixture', actorId: 'actor-fixture', loadId: 'load-fixture', kind: 'cte' as const, documentId: 'document-fixture', format: 'pdf' as const };
const session = { data: { session: { user: { id: request.actorId }, access_token: 'SYNTHETIC-USER-JWT' } }, error: null };
const fetcher = vi.fn<typeof fetch>();
function file(body = '%PDF-1.7 synthetic329', filename = 'cte-329.pdf', contentType = 'application/pdf') {
  return new Response(body, { headers: { 'Content-Type': contentType, 'Content-Disposition': 'attachment; filename="' + filename + '"' } });
}
beforeEach(() => {
  vi.stubEnv('VITE_SUPABASE_URL', 'https://driver-fiscal-fixture.invalid');
  setActiveTenantId(request.tenantId); mock.getSession.mockReset().mockResolvedValue(session);
  fetcher.mockReset().mockResolvedValue(file()); vi.stubGlobal('fetch', fetcher);
});
afterEach(() => { setActiveTenantId(null); vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
describe('F05 browser downloads only authenticated bytes', () => {
  it('uses POST to AGV Edge with captured tenant and user JWT headers, never RPC/provider URLs', async () => {
    const result = await downloadDriverFiscalFile(request, new AbortController().signal);
    expect(await result.blob.text()).toBe('%PDF-1.7 synthetic329'); expect(result.filename).toBe('cte-329.pdf');
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://driver-fiscal-fixture.invalid/functions/v1/driver-fiscal-file');
    expect(String(url)).not.toContain('SYNTHETIC-USER-JWT');
    expect(init).toMatchObject({ method: 'POST', cache: 'no-store', redirect: 'error', credentials: 'omit',
      headers: { Authorization: 'Bearer SYNTHETIC-USER-JWT', 'x-agvlog-tenant-id': request.tenantId } });
    expect(JSON.parse(init?.body as string)).toEqual({ tenant_id: request.tenantId, load_id: request.loadId,
      kind: 'cte', document_id: request.documentId, format: 'pdf' });
  });
  it('accepts XML bytes and the sanitized filename', async () => {
    fetcher.mockResolvedValue(file('<cteProc/>', 'cte-329.xml', 'application/xml;charset=utf-8'));
    const result = await downloadDriverFiscalFile({ ...request, format: 'xml' }, new AbortController().signal);
    expect(await result.blob.text()).toBe('<cteProc/>'); expect(result.filename).toBe('cte-329.xml');
  });
  it.each(['missing', 'actor', 'tenant'])('rejects %s context before fetching', async state => {
    if (state === 'missing') mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
    if (state === 'actor') mock.getSession.mockResolvedValue({ data: { session: { ...session.data.session, user: { id: 'other' } } }, error: null });
    if (state === 'tenant') setActiveTenantId('other');
    await expect(downloadDriverFiscalFile(request, new AbortController().signal)).rejects.toThrow('Sessão fiscal');
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each(['tenant', 'actor', 'logout', 'token'])('discards bytes after %s changes while fetching', async state => {
    fetcher.mockImplementation(async () => {
      if (state === 'tenant') setActiveTenantId('other');
      if (state === 'actor') mock.getSession.mockResolvedValue({ data: { session: { ...session.data.session, user: { id: 'other' } } }, error: null });
      if (state === 'logout') mock.getSession.mockResolvedValue({ data: { session: null }, error: null });
      if (state === 'token') mock.getSession.mockResolvedValue({ data: { session: { ...session.data.session, access_token: 'new-token' } }, error: null });
      return file();
    });
    await expect(downloadDriverFiscalFile(request, new AbortController().signal)).rejects.toThrow('Contexto fiscal');
  });
  it('discards an aborted download even if a transport ignores the signal', async () => {
    const controller = new AbortController();
    fetcher.mockImplementation(async () => { controller.abort(); return file(); });
    await expect(downloadDriverFiscalFile(request, controller.signal)).rejects.toThrow('Contexto fiscal');
  });
  it.each([new Response('secret upstream error', { status: 401 }), file('<html>login</html>'), file('%PDF', '../unsafe.pdf'), file('%PDF', 'cte-329.pdf', 'application/json')])('rejects nonfile/error/unsafe responses without exposing their body', async response => {
    fetcher.mockResolvedValue(response);
    await expect(downloadDriverFiscalFile(request, new AbortController().signal)).rejects.toThrow();
  });
});
