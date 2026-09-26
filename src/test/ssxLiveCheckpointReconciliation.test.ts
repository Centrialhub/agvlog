// @vitest-environment node
import { readFileSync } from 'node:fs';
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import {
  checkpointedSync,
  SsxSyncError,
  waitSsxTurn,
} from '../../supabase/functions/_shared/ssx-sync-checkpoint.ts';
import { normalizeSnapshot } from '../../supabase/functions/ssx-sync-governance/snapshot-normalization.ts';
import { governanceUnitIdentity } from '../../supabase/functions/ssx-sync-governance/unit-identity.ts';
import { ssxResponseDiagnostic } from '../../supabase/functions/_shared/ssx-response-diagnostics.ts';

type Row = Record<string, unknown>;

beforeAll(() => {
  vi.stubGlobal('Deno', { env: { get: () => undefined } });
});

afterAll(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('reconciled SSX checkpoint and pacing', () => {
  it('requires an explicit delay and preserves the 250 ms and 1000 ms intervals', async () => {
    vi.useFakeTimers();
    expect(() => (waitSsxTurn as (value?: number) => Promise<void>)()).toThrow(/explicit SSX pacing/);
    for (const delay of [250, 1000] as const) {
      let completed = false;
      const pending = waitSsxTurn(delay).then(() => { completed = true; });
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(completed).toBe(false);
      await vi.advanceTimersByTimeAsync(1);
      await pending;
      expect(completed).toBe(true);
    }
    vi.useRealTimers();
    const governance = readFileSync('supabase/functions/ssx-sync-governance/index.ts', 'utf8');
    const pipeline = readFileSync('supabase/functions/agvlog-pipeline-run/index.ts', 'utf8');
    expect(governance).toContain('await waitSsxTurn(1000)');
    expect(pipeline).toContain("checkpointedSync(supabase, account.id, 'pipeline_units'");
    expect(pipeline).not.toContain('waitSsxTurn(');
  });

  it('returns valid cached results and respects deferred retries without executing', async () => {
    const execute = vi.fn(async () => ({ upserted: 4 }));
    const cachedClient = { rpc: vi.fn(async () => ({
      data: { decision: 'cached', result: { upserted: 0 } }, error: null,
    })) };
    await expect(checkpointedSync(cachedClient, 'account', 'pipeline_units', '', execute))
      .resolves.toEqual({ upserted: 0 });
    expect(execute).not.toHaveBeenCalled();
    expect(cachedClient.rpc).toHaveBeenCalledTimes(1);

    const deferredClient = { rpc: vi.fn(async () => ({
      data: { decision: 'deferred', error_code: 'rate_limited', retry_after_seconds: 300 }, error: null,
    })) };
    await expect(checkpointedSync(deferredClient, 'account', 'pipeline_units', '', execute))
      .rejects.toMatchObject({ code: 'rate_limited', retrySeconds: 300 });
    expect(execute).not.toHaveBeenCalled();
  });

  it('records a claimed result or failure through the checkpoint RPC', async () => {
    const calls: Array<{ name: string; args: Row }> = [];
    const client = { rpc: async (name: string, args: Row) => {
      calls.push({ name, args });
      if (name === 'claim_ssx_sync_checkpoint_v1') {
        return { data: { decision: 'claimed', lease_token: 'lease' }, error: null };
      }
      return { data: true, error: null };
    } };
    await expect(checkpointedSync(client, 'account', 'pipeline_units', '', async () => ({ upserted: 0 })))
      .resolves.toEqual({ upserted: 0 });
    expect(calls[1]).toMatchObject({
      name: 'finish_ssx_sync_checkpoint_v1',
      args: { _result: { upserted: 0 }, _error_code: null, _retry_seconds: 0 },
    });

    calls.length = 0;
    await expect(checkpointedSync(client, 'account', 'pipeline_units', '', async () => {
      throw new SsxSyncError('rate_limited', 300);
    })).rejects.toMatchObject({ code: 'rate_limited', retrySeconds: 300 });
    expect(calls[1]).toMatchObject({
      name: 'finish_ssx_sync_checkpoint_v1',
      args: { _result: {}, _error_code: 'rate_limited', _retry_seconds: 300 },
    });
  });
});

describe('reconciled governance and Retry-After handling', () => {
  it('uses verified integration identity and refuses duplicate snapshot keys', () => {
    expect(governanceUnitIdentity({
      external_code: 'local-key',
      metadata: { tracked_unit_integration_code: 'ssx-key', tracked_unit: 'vehicle' },
    })).toMatchObject({
      scope: 'local-key', code: 'ssx-key',
      filter: { PropertyName: 'TrackedUnitIntegrationCode', Condition: 'Equal', Value: 'ssx-key' },
    });
    expect(governanceUnitIdentity({
      external_code: 'local-key', metadata: { tracked_unit: 'vehicle' },
    })).toMatchObject({
      scope: 'local-key', code: null,
      filter: { PropertyName: 'TrackedUnitIdentification', Condition: 'Equal', Value: 'vehicle' },
    });
    expect(normalizeSnapshot([{ id: 'same' }, { id: 'same' }], 'id')).toEqual({
      items: null, error: 'duplicate_external_key',
    });
    const diagnostic = ssxResponseDiagnostic([{ id: 'private-value' }], 'provider message', 'id');
    expect(diagnostic).toMatchObject({ shape: 'array', count: 1, key_types: { string: 1 } });
    expect(JSON.stringify(diagnostic)).not.toContain('private-value');
  });

  it('classifies external 429 and captures Retry-After while clearing its timer', async () => {
    vi.useFakeTimers();
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', {
      status: 429,
      headers: { 'Retry-After': '600' },
    })));
    const { ssxPost } = await import('../../supabase/functions/_shared/ssx-utils.ts');
    const result = await ssxPost('https://provider.example.test/Tracking/List', 'synthetic-token', [], 10_000);
    expect(result).toMatchObject({ status: 429, errorClass: 'rate_limited', retryAfterSeconds: 600 });
    expect(vi.getTimerCount()).toBe(0);
    vi.useRealTimers();
  });
});
