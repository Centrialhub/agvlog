import { describe, expect, it, vi } from 'vitest';
import {
  classifyFiscalProviderStatus,
  getHubFiscalDocument,
  safeProviderSnapshot,
  selectHubFiscalCredential,
  resolveHubFiscalToken,
  shouldDeadLetter,
} from '../../supabase/functions/_shared/fiscal-poll';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('fiscal polling terminal policy', () => {
  const freshDocument = {
    id: 'doc-1',
    tenant_id: 'tenant-1',
    created_at: '2026-08-26T12:00:00.000Z',
    status_check_attempts: 0,
  };

  it('moves a transient document to reconciliation after fifteen minutes', () => {
    expect(shouldDeadLetter(freshDocument, true, Date.parse('2026-08-26T12:15:00.000Z'))).toBe(true);
    expect(shouldDeadLetter(freshDocument, true, Date.parse('2026-08-26T12:14:59.999Z'))).toBe(false);
  });

  it('limits missing provider references to five checks', () => {
    expect(shouldDeadLetter({ ...freshDocument, status_check_attempts: 3 }, false, Date.parse('2026-08-26T12:01:00Z'))).toBe(false);
    expect(shouldDeadLetter({ ...freshDocument, status_check_attempts: 4 }, false, Date.parse('2026-08-26T12:01:00Z'))).toBe(true);
  });

  it('stores only allowlisted provider metadata and redacts credentials', () => {
    const snapshot = safeProviderSnapshot(401, {
      document: {
        status: 'processing',
        cStat: 999,
        raw_response_json: {
          error: { message: 'token=abc123 Bearer secret-value' },
        },
        customer: { cpf: '00000000000' },
      },
    });

    expect(snapshot).toMatchObject({
      http_status: 401,
      provider_status: 'processing',
      provider_code: '999',
    });
    expect(JSON.stringify(snapshot)).not.toContain('00000000000');
    expect(JSON.stringify(snapshot)).not.toContain('abc123');
    expect(JSON.stringify(snapshot)).not.toContain('secret-value');
  });

  it('classifica estados equivalentes de CT-e e NFS-e em um único contrato', () => {
    expect(classifyFiscalProviderStatus('AUTORIZADO')).toBe('issued');
    expect(classifyFiscalProviderStatus('emitida')).toBe('issued');
    expect(classifyFiscalProviderStatus('denegado')).toBe('rejected');
    expect(classifyFiscalProviderStatus('cancelada')).toBe('cancelled');
    expect(classifyFiscalProviderStatus('processing')).toBeNull();
  });

  it('prioriza credencial específica do documento e ambiente', () => {
    const credentials = [
      { doc_scope: 'all', environment: 'production', secret_name: 'ALL_PROD', secret_ciphertext: null },
      { doc_scope: 'cte', environment: 'sandbox', secret_name: 'CTE_SANDBOX', secret_ciphertext: null },
      { doc_scope: 'cte', environment: 'production', secret_name: 'CTE_PROD', secret_ciphertext: null },
    ];

    expect(selectHubFiscalCredential(credentials, 'cte', 'production')?.secret_name).toBe('CTE_PROD');
    expect(selectHubFiscalCredential(credentials, 'nfse', 'production')?.secret_name).toBe('ALL_PROD');
  });

  it('nunca reutiliza credencial de outro ambiente', () => {
    const credentials = [
      { doc_scope: 'cte', environment: 'sandbox', secret_name: 'CTE_SANDBOX', secret_ciphertext: null },
    ];

    expect(selectHubFiscalCredential(credentials, 'cte', 'production')).toBeNull();
    expect(selectHubFiscalCredential(credentials, 'cte', null)).toBeNull();
    expect(selectHubFiscalCredential([{ ...credentials[0], environment: null }], 'cte', 'production')).toBeNull();
  });

  it('does not call the provider when scoped credentials are unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const response = await getHubFiscalDocument({ baseUrl: 'https://hub.example.test', hubDocumentId: 'document', token: '', fetcher });
    expect(response.status).toBe(424);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('requires tenant and emitter credentials without a global fallback', async () => {
    const filters: unknown[][] = [];
    const query = {
      select: () => query,
      eq: (key: string, value: unknown) => { filters.push([key, value]); return query; },
      then: (resolve: (result: unknown) => unknown) => Promise.resolve({
        data: [{ doc_scope: 'all', environment: 'production', secret_name: 'PROD', secret_ciphertext: null }], error: null,
      }).then(resolve),
    };
    const admin = { from: () => query };
    const input = { tenantId: 'tenant', emitterId: 'emitter', environment: 'homologation', scope: 'cte' as const, encryptionKey: '', getSecret: () => 'production-secret' };
    expect(await resolveHubFiscalToken(admin, input)).toBe('');
    expect(filters).toContainEqual(['tenant_id', 'tenant']);
    expect(await resolveHubFiscalToken(admin, { ...input, environment: 'production' })).toBe('production-secret');
    expect(await resolveHubFiscalToken(admin, { ...input, emitterId: null })).toBe('');
  });

  it('não chama o provedor quando HUB_FISCAL_BASE_URL está ausente', async () => {
    const fetcher = vi.fn<typeof fetch>();
    const result = await getHubFiscalDocument({
      baseUrl: '',
      hubDocumentId: 'doc-1',
      token: 'secret',
      fetcher,
    });

    expect(result.status).toBe(503);
    expect(fetcher).not.toHaveBeenCalled();
  });

  it('consulta o Hub Fiscal com id codificado e token bearer', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ document: { status: 'authorized' } }), { status: 200 }),
    );
    const result = await getHubFiscalDocument({
      baseUrl: 'https://hub.example.test/',
      hubDocumentId: 'cte id/1',
      token: 'secret-token',
      fetcher,
    });

    expect(result.status).toBe(200);
    const [url, init] = fetcher.mock.calls[0];
    expect(String(url)).toBe('https://hub.example.test/hub_documents_get?id=cte+id%2F1');
    expect(init?.headers).toMatchObject({ Authorization: 'Bearer secret-token' });
  });

  it('terminaliza e enfileira em uma única RPC restrita ao service role', () => {
    const migration = readFileSync(
      join(process.cwd(), 'supabase', 'migrations', '20260826162000_fiscal_dead_letter_terminalize.sql'),
      'utf8',
    );
    const ctePoller = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'cte-status-poll', 'index.ts'),
      'utf8',
    );
    const nfsePoller = readFileSync(
      join(process.cwd(), 'supabase', 'functions', 'nfse-status-poll', 'index.ts'),
      'utf8',
    );

    expect(migration).toContain('CREATE OR REPLACE FUNCTION public.terminalize_fiscal_poll_v1');
    expect(migration).toContain("ON CONFLICT (document_kind, document_id) WHERE status = 'open'");
    expect(migration).toContain('FROM PUBLIC, anon, authenticated');
    expect(migration).toContain('TO service_role');
    expect(ctePoller).toContain('terminalizeFiscalPoll(admin');
    expect(nfsePoller).toContain('terminalizeFiscalPoll(admin');
    for (const poller of [ctePoller, nfsePoller]) {
      expect(poller).toContain('resolveHubFiscalToken(admin');
      expect(poller).toContain('getHubFiscalDocument({');
      expect(poller).toContain('classifyFiscalProviderStatus(rawStatus)');
      expect(poller).not.toMatch(/function\s+(resolveToken|hubGet|classify)\s*\(/);
    }
  });
});
