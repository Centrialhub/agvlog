// @vitest-environment node
import { describe, expect, it } from 'vitest';
import type { APIRequestContext } from '@playwright/test';
import { cleanupSyntheticManualLoad } from '../../e2e/fixtures/loadCleanup';

const fixture = {
  tenantId: '20000000-0000-4000-8000-000000000001',
  loadId: '70000000-0000-4000-8000-000000000099',
  loadNumber: 'E2E-RPC-isolated',
  itemId: '90000000-0000-4000-8000-000000000099',
};
const session = { backendUrl: 'http://127.0.0.1:54321', publishableKey: 'fixture-key', accessToken: 'fixture-token' };

function harness(options: { absent?: boolean; otherNumber?: boolean; otherItem?: boolean; document?: boolean; itemError?: 403 | 409; retained?: boolean } = {}) {
  const load = { id: fixture.loadId, tenant_id: fixture.tenantId, load_number: options.otherNumber ? 'OTHER' : fixture.loadNumber, version: 7 };
  const item = { id: options.otherItem ? '90000000-0000-4000-8000-000000000098' : fixture.itemId,
    tenant_id: fixture.tenantId, load_id: fixture.loadId,
    fiscal_document_id: options.document ? 'a0000000-0000-4000-8000-000000000099' : null,
    order_id: null, item_description: 'Item de contrato E2E', quantity: 3,
    pallet_count: 2, weight_kg: 120, volume_m3: 1.5,
    status: 'pending', notes: null, updated_at: '2026-09-26T12:00:00+00:00' };
  let loads = options.absent ? [] : [load];
  let items = options.absent ? [] : [item];
  const calls: Array<{ name: string; data: Record<string, unknown> }> = [];
  const response = (data: unknown, status = 200) => ({ ok: () => status === 200, status: () => status, json: async () => structuredClone(data) });
  const request = {
    get: async (raw: string) => {
      const url = new URL(raw);
      expect(url.searchParams.get('tenant_id')).toBe(`eq.${fixture.tenantId}`);
      if (url.pathname.endsWith('/loads')) {
        expect(url.searchParams.get('id')).toBe(`eq.${fixture.loadId}`);
        return response(loads);
      }
      expect(url.pathname).toBe('/rest/v1/load_items');
      expect(url.searchParams.get('load_id')).toBe(`eq.${fixture.loadId}`);
      return response(items);
    },
    post: async (raw: string, { data }: { data: Record<string, unknown> }) => {
      const name = new URL(raw).pathname.split('/').at(-1)!;
      calls.push({ name, data });
      if (name === 'delete_load_item_v4') {
        if (options.itemError) return response({
          error: options.itemError === 403 ? 'not_authorized' : 'load_item_expected_changed',
          code: options.itemError === 403 ? '42501' : '40001',
        }, options.itemError);
        items = [];
        return response(true);
      }
      expect(name).toBe('apply_load_aggregate_command');
      if (!options.retained) loads = [];
      return response({ ok: true, action: 'delete', deleted_load_ids: [fixture.loadId] });
    },
  } as unknown as APIRequestContext;
  return { request, calls };
}

describe('isolated E2E load cleanup', () => {
  it('uses operator commands and the current revision, then verifies persistence', async () => {
    const { request, calls } = harness();
    await cleanupSyntheticManualLoad(request, session, fixture);
    expect(calls.map(call => call.name)).toEqual(['delete_load_item_v4', 'apply_load_aggregate_command']);
    expect(calls[0].data).toEqual({ p_tenant_id: fixture.tenantId, p_item_id: fixture.itemId, p_expected: {
      order_id: null, item_description: 'Item de contrato E2E', quantity: 3, pallet_count: 2,
      weight_kg: 120, volume_m3: 1.5, status: 'pending', notes: null,
      updated_at: '2026-09-26T12:00:00+00:00',
    } });
    expect(calls[1].data).toMatchObject({ _payload: {
      schema_version: 1, tenant_id: fixture.tenantId, action: 'delete', load_id: fixture.loadId, expected_version: 7,
    } });
  });
  it('accepts already removed fixtures without issuing a write', async () => {
    const { request, calls } = harness({ absent: true });
    await cleanupSyntheticManualLoad(request, session, fixture);
    expect(calls).toEqual([]);
  });
  it.each([{ otherNumber: true }, { document: true }, { otherItem: true }])('refuses an unexpected load or item before deletion: %j', async options => {
    const { request, calls } = harness(options);
    await expect(cleanupSyntheticManualLoad(request, session, fixture)).rejects.toThrow();
    expect(calls).toEqual([]);
  });
  it('refuses an item when its create response did not confirm the ID', async () => {
    const { request, calls } = harness();
    await expect(cleanupSyntheticManualLoad(request, session, { ...fixture, itemId: null })).rejects.toThrow('creation ID');
    expect(calls).toEqual([]);
  });
  it.each([403, 409] as const)('does not force-delete the load after item deletion fails with HTTP %s', async status => {
    const { request, calls } = harness({ itemError: status });
    await expect(cleanupSyntheticManualLoad(request, session, fixture)).rejects.toThrow(`HTTP ${status}`);
    expect(calls.map(call => call.name)).toEqual(['delete_load_item_v4']);
  });
  it('rejects a successful RPC response when the load still exists', async () => {
    const { request } = harness({ retained: true });
    await expect(cleanupSyntheticManualLoad(request, session, fixture)).rejects.toThrow('cleanup must persist');
  });
});
