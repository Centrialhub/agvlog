import { describe, expect, it, vi } from 'vitest';
import {
  HUB_ENVIRONMENTS, requireHubEnvironment, requireHubDocumentScope, selectScopedHubCredential,
} from '../../supabase/functions/_shared/fiscal-environment';
import { hubFiscal } from '@/lib/fiscal/hubFiscalClient';

const invoke = vi.hoisted(() => vi.fn().mockResolvedValue({ data: { success: true }, error: null }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { functions: { invoke } } }));

describe('shared fiscal environment boundary', () => {
  it.each(HUB_ENVIRONMENTS)('preserves %s without normalization to another environment', environment => {
    expect(requireHubEnvironment(environment)).toBe(environment);
    expect(requireHubEnvironment(undefined, environment, environment)).toBe(environment);
  });
  it.each([undefined, null, '', 'homologacao', 'PRODUCTION', 'invalid', 2])('rejects missing/unknown environment %s', value => {
    expect(() => requireHubEnvironment(value)).toThrow();
  });
  it('rejects disagreement with the stored document', () => {
    expect(() => requireHubEnvironment('production', 'homologation')).toThrow(/difere/);
  });
  it('recognizes NFCom and never broadens unknown scopes to all', () => {
    expect(requireHubDocumentScope('nfcom')).toBe('nfcom');
    expect(() => requireHubDocumentScope('typo')).toThrow();
  });
  it.each(HUB_ENVIRONMENTS)('selects only enabled matching %s credentials, preferring exact scope', environment => {
    const credentials = HUB_ENVIRONMENTS.flatMap(env => [
      { doc_scope: 'all', environment: env, enabled: true, name: `${env}-all` },
      { doc_scope: 'cte', environment: env, enabled: true, name: `${env}-cte` },
    ]);
    expect(selectScopedHubCredential(credentials, 'cte', environment)?.name).toBe(`${environment}-cte`);
    expect(selectScopedHubCredential(credentials, 'nfse', environment)?.name).toBe(`${environment}-all`);
    expect(selectScopedHubCredential(credentials.map(c => ({ ...c, enabled: false })), 'cte', environment)).toBeNull();
  });
  it('does not use production, unscoped or unknown credentials for homologation', () => {
    expect(selectScopedHubCredential([
      { doc_scope: 'all', environment: 'production' },
      { doc_scope: 'cte', environment: null },
    ], 'cte', 'homologation')).toBeNull();
  });
  it('rejects ambiguous credentials instead of selecting the first row', () => {
    const credential = { doc_scope: 'cte', environment: 'production' };
    expect(() => selectScopedHubCredential([credential, credential], 'cte', 'production')).toThrow(/Mais de uma/);
  });
});

describe('fiscal frontend request contract', () => {
  it.each(HUB_ENVIRONMENTS)('sends the selected %s environment for emission and credential diagnostics', async environment => {
    await hubFiscal.emit({ type: 'nfcom', emitterId: 'emitter', body: { emitterCnpj: '12345678000199', environment, payload: {} } });
    expect(invoke).toHaveBeenLastCalledWith('hub-fiscal-proxy', { body: expect.objectContaining({ body: expect.objectContaining({ environment }), type: 'nfcom' }) });
    await hubFiscal.ping('emitter', 'all', environment);
    expect(invoke).toHaveBeenLastCalledWith('hub-fiscal-proxy', { body: { action: 'ping', emitterId: 'emitter', type: 'all', environment } });
  });
  it('rejects a conflicting query environment before any request', () => {
    invoke.mockClear();
    expect(() => hubFiscal.query({ environment: 'production' }, 'emitter', 'homologation')).toThrow();
    expect(invoke).not.toHaveBeenCalled();
  });
});
