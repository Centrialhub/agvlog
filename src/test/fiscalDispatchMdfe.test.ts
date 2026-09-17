// @vitest-environment node
import { describe, expect, it, vi } from 'vitest';
import { dispatchFiscalEmission } from '../../supabase/functions/_shared/fiscal-dispatch';

describe('MDF-e durable dispatch boundary', () => {
  it('reserves MDF-e through the manifest-aware claim before any provider request', async () => {
    const body = {
      environment: 'production',
      emitterCnpj: '18666510000168',
      idIntegracao: 'agvlog-mdfe-load-manifest-1',
      payload: { idIntegracao: 'agvlog-mdfe-load-manifest-1' },
    };
    const rpc = vi.fn().mockResolvedValue({
      data: {
        dispatch: false,
        emission: { id: 'emission-1', request_payload: body },
      },
      error: null,
    });
    const call = vi.fn();

    const result = await dispatchFiscalEmission({
      admin: { rpc } as never,
      tenant: 'tenant-1',
      actor: 'actor-1',
      emitter: 'emitter-1',
      type: 'mdfe',
      environment: 'production',
      body,
      loadManifestId: 'manifest-1',
      call,
    });

    expect(rpc).toHaveBeenCalledOnce();
    expect(rpc).toHaveBeenCalledWith('claim_mdfe_fiscal_emission', {
      _tenant: 'tenant-1',
      _actor: 'actor-1',
      _emitter: 'emitter-1',
      _environment: 'production',
      _body: body,
      _load_manifest_id: 'manifest-1',
    });
    expect(call).not.toHaveBeenCalled();
    expect(result).toMatchObject({
      status: 409,
      data: { error: { code: 'FISCAL_RECONCILIATION_REQUIRED' } },
    });
  });
});
