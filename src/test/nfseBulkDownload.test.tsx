import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchNfseHubRefs, nfseDownloadErrorMessage } from '@/lib/fiscal/nfseDownload';

const mocks = vi.hoisted(() => ({ tenant: 'tenant-a', getSession: vi.fn(), refreshSession: vi.fn(), from: vi.fn(), order: vi.fn(), eq: vi.fn(), inside: vi.fn() }));
vi.mock('@/lib/tenant/activeTenantContext', () => ({ getActiveTenantId: () => mocks.tenant }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { auth: { getSession: mocks.getSession, refreshSession: mocks.refreshSession }, from: mocks.from } }));
const session = () => ({ data: { session: { user: { id: 'user-a' }, access_token: 'test-only' } }, error: null });
const ok = { status: 200, error: null, data: [{ id: 'emission', nfse_document_id: 'nfse', hub_document_id: 'hub' }] };
const expired = { status: 401, data: null, error: { code: 'PGRST301', message: 'JWT expired' } };

beforeEach(() => {
  vi.clearAllMocks();
  mocks.tenant = 'tenant-a';
  mocks.getSession.mockReset().mockResolvedValue(session());
  mocks.refreshSession.mockReset().mockResolvedValue(session());
  mocks.order.mockReset().mockResolvedValue(ok);
  const query = { select: vi.fn().mockReturnThis(), eq: mocks.eq, in: mocks.inside, order: mocks.order };
  mocks.eq.mockReturnValue(query); mocks.inside.mockReturnValue(query); mocks.from.mockReturnValue(query);
});

describe('NFS-e file reference authentication', () => {
  it('reads references scoped to the active company without refreshing a valid session', async () => {
    expect((await fetchNfseHubRefs(['nfse'])).get('nfse')?.hubDocumentId).toBe('hub');
    expect(mocks.eq).toHaveBeenCalledWith('tenant_id', 'tenant-a');
    expect(mocks.refreshSession).not.toHaveBeenCalled();
  });
  it('recovers the reported 401 once and repeats only the read', async () => {
    mocks.order.mockResolvedValueOnce(expired).mockResolvedValueOnce(ok);
    expect((await fetchNfseHubRefs(['nfse'])).size).toBe(1);
    expect(mocks.refreshSession).toHaveBeenCalledTimes(1);
    expect(mocks.order).toHaveBeenCalledTimes(2);
  });
  it('asks for login when refresh fails instead of hiding the error', async () => {
    mocks.order.mockResolvedValueOnce(expired);
    mocks.refreshSession.mockResolvedValueOnce({ data: { session: null }, error: { message: 'Invalid refresh token' } });
    await expect(fetchNfseHubRefs(['nfse'])).rejects.toThrow('Entre novamente');
    expect(mocks.order).toHaveBeenCalledTimes(1);
  });
  it('never loops if the renewed session is also rejected', async () => {
    mocks.order.mockResolvedValue(expired);
    await expect(fetchNfseHubRefs(['nfse'])).rejects.toThrow('sessão expirou');
    expect(mocks.order).toHaveBeenCalledTimes(2);
  });
  it('preserves structured database errors and does not refresh on permission failure', async () => {
    mocks.order.mockResolvedValue({ status: 403, error: { message: 'Acesso negado' }, data: null });
    await expect(fetchNfseHubRefs(['nfse'])).rejects.toThrow('Acesso negado');
    expect(mocks.refreshSession).not.toHaveBeenCalled();
    expect(nfseDownloadErrorMessage({ message: 'Falha de conexão' })).toBe('Falha de conexão');
  });
  it('stops before reading without a session', async () => {
    mocks.getSession.mockResolvedValue({ data: { session: null }, error: null });
    await expect(fetchNfseHubRefs(['nfse'])).rejects.toThrow('Entre novamente');
    expect(mocks.from).not.toHaveBeenCalled();
  });
  it('discards references if the company changes during the request', async () => {
    mocks.order.mockImplementationOnce(async () => { mocks.tenant = 'tenant-b'; return ok; });
    await expect(fetchNfseHubRefs(['nfse'])).rejects.toThrow('empresa ou a sessão mudou');
  });
  it('does not retry under another user after refresh', async () => {
    mocks.order.mockResolvedValueOnce(expired);
    mocks.refreshSession.mockImplementationOnce(async () => {
      mocks.getSession.mockResolvedValue({ data: { session: { user: { id: 'user-b' } } }, error: null });
      return session();
    });
    await expect(fetchNfseHubRefs(['nfse'])).rejects.toThrow('empresa ou a sessão mudou');
    expect(mocks.order).toHaveBeenCalledTimes(1);
  });
  it('keeps bounded chunks and performs no read for empty input', async () => {
    expect((await fetchNfseHubRefs([])).size).toBe(0);
    expect(mocks.from).not.toHaveBeenCalled();
    await fetchNfseHubRefs(Array.from({ length: 201 }, (_, i) => String(i)));
    expect(mocks.inside.mock.calls.map(call => call[1].length)).toEqual([200, 1]);
  });
});
