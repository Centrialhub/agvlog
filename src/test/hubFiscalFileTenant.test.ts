import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';
import {
  clearActiveTenantId,
  setActiveTenantId,
} from '@/lib/tenant/activeTenantContext';

const { getSession } = vi.hoisted(() => ({
  getSession: vi.fn(),
}));

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {
    auth: { getSession },
    functions: { invoke: vi.fn() },
  },
}));

const TENANT_ID = '10000000-0000-4000-8000-000000000001';

describe('hubFiscal.file tenant context', () => {
  beforeEach(() => {
    vi.stubEnv('VITE_SUPABASE_URL', 'https://project.supabase.co');
    vi.stubEnv('VITE_SUPABASE_PUBLISHABLE_KEY', 'publishable-test-key');
    setActiveTenantId(TENANT_ID);
    getSession.mockReset().mockResolvedValue({
      data: { session: { access_token: 'user-access-token' } },
      error: null,
    });
  });

  afterEach(() => {
    clearActiveTenantId();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  it('forwards the active tenant when downloading a fiscal file', async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response('%PDF-1.7\ncontent', {
        status: 200,
        headers: { 'Content-Type': 'application/pdf' },
      }),
    );
    vi.stubGlobal('fetch', fetchMock);

    await hubFiscal.file('hub-document-id', 'pdf', { type: 'cte' });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const headers = new Headers(init.headers);

    expect(url).toBe('https://project.supabase.co/functions/v1/hub-fiscal-proxy');
    expect(headers.get('x-agvlog-tenant-id')).toBe(TENANT_ID);
    expect(headers.get('authorization')).toBe('Bearer user-access-token');
  });

  it('fails before making a request when no active tenant is confirmed', async () => {
    clearActiveTenantId();
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(hubFiscal.file('hub-document-id', 'pdf', { type: 'cte' }))
      .rejects.toThrow('Empresa ativa não confirmada');

    expect(getSession).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('preserves the proxy error code returned by a 409 response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ error: 'tenant_context_mismatch' }), {
          status: 409,
          headers: { 'Content-Type': 'application/json' },
        }),
      ),
    );

    await expect(hubFiscal.file('hub-document-id', 'pdf', { type: 'cte' }))
      .rejects.toThrow('tenant_context_mismatch');
  });
});
