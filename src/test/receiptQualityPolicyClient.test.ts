import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mocks.rpc } }));

import {
  BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,
  baselineReceiptScanQualityPolicy,
  readCachedReceiptScanQualityPolicy,
  resolveReceiptScanQualityPolicy,
  saveReceiptScanQualityPolicy,
} from '@/lib/driver/receiptQualityPolicy';

const tenant = '20000000-0000-4000-8000-000000000001';
const client = '30000000-0000-4000-8000-000000000001';
const stop = '40000000-0000-4000-8000-000000000001';
const policyId = '50000000-0000-4000-8000-000000000001';
const policy = {
  source:'client' as const,policy_id:policyId,version:3,tenant_id:tenant,client_id:client,
  thresholds:{...BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,min_source_pixels:4_000_000},
  resolved_at:'2026-09-10T18:00:00.000Z',
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  Object.defineProperty(navigator, 'onLine', { configurable: true, value: true });
});

describe('receipt quality policy client', () => {
  it('loads, validates and caches the effective client policy', async () => {
    mocks.rpc.mockResolvedValue({ data:policy,error:null });
    await expect(resolveReceiptScanQualityPolicy(tenant,client,stop)).resolves.toEqual(policy);
    expect(mocks.rpc).toHaveBeenCalledWith('resolve_delivery_receipt_quality_policy_v1',{_stop_id:stop});
    expect(readCachedReceiptScanQualityPolicy(tenant,client)).toEqual(policy);
  });

  it('uses the cached policy offline and baseline when the device has never synchronized one', async () => {
    mocks.rpc.mockResolvedValueOnce({data:policy,error:null});
    await resolveReceiptScanQualityPolicy(tenant,client,stop);
    Object.defineProperty(navigator, 'onLine', { configurable:true,value:false });
    await expect(resolveReceiptScanQualityPolicy(tenant,client,stop)).resolves.toEqual(policy);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    const otherClient='30000000-0000-4000-8000-000000000002';
    await expect(resolveReceiptScanQualityPolicy(tenant,otherClient,stop)).resolves.toMatchObject({
      source:'baseline',policy_id:null,version:1,client_id:otherClient,
    });
  });

  it('rejects a response from another stop scope and validates saves before calling the API', async () => {
    mocks.rpc.mockResolvedValueOnce({data:{...policy,client_id:null},error:null});
    await expect(resolveReceiptScanQualityPolicy(tenant,client,stop)).rejects.toThrow('não pertence');
    await expect(saveReceiptScanQualityPolicy({
      tenantId:tenant,clientId:client,expectedActivePolicyId:null,
      thresholds:{...BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,min_brightness_reject:90,min_brightness_warn:50},
    })).rejects.toThrow('fora de ordem');
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
  });

  it('constructs the immutable baseline snapshot with the requested scope identifiers', () => {
    expect(baselineReceiptScanQualityPolicy(tenant,client,new Date('2026-09-10T12:00:00Z'))).toEqual({
      source:'baseline',policy_id:null,version:1,tenant_id:tenant,client_id:client,
      thresholds:BASELINE_RECEIPT_SCAN_QUALITY_THRESHOLDS,resolved_at:'2026-09-10T12:00:00.000Z',
    });
  });
});
