import { beforeEach, describe, expect, it, vi } from 'vitest';

const mock = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock('@/integrations/supabase/client', () => ({ supabase: { rpc: mock.rpc } }));

import { getTripCargoCollectionPage, getTripCargoControl, listTripCargoControls } from '@/lib/driver/tripCargoCustody';

const tenant = '20000000-0000-4000-8000-000000000001';
const trip = '20000000-0000-4000-8000-000000000002';
const control = '20000000-0000-4000-8000-000000000003';
const driver = '20000000-0000-4000-8000-000000000004';
const vehicle = '20000000-0000-4000-8000-000000000005';
const divergences = Array.from({ length: 501 }, (_, index) => ({
  id: `20000000-0000-4000-8000-${String(index + 10).padStart(12, '0')}`,
  load_id: null,
  divergence_kind: 'other',
  description: `Divergência ${index + 1}`,
  expected_value: null,
  observed_value: null,
  status: 'pending',
  review_reason: null,
}));

beforeEach(() => {
  mock.rpc.mockReset();
  mock.rpc.mockImplementation(async (name: string, args: Record<string, unknown>) => {
    if (name === 'get_trip_cargo_control_v2') return { error: null, data: {
      version: 2, available: true, tenant_id: tenant, trip_id: trip, trip_status: 'loading',
      control: { id: control, tenant_id: tenant, dispatch_trip_id: trip, driver_id: driver, vehicle_id: vehicle,
        status: 'loading', vehicle_checked: true, tie_down_confirmed: true, seal_not_applicable_reason: null,
        updated_at: '2026-09-17T00:00:00.000Z' },
      collection_counts: { loads: 0, documents: 0, seals: 0, evidence: 0, divergences: 501 },
      physical_receipts: { required_count: 0, pending_count: 0, missing_count: 0 },
    } };
    if (name === 'get_trip_cargo_collection_page_v1') {
      const collection = String(args._collection);
      const page = Number(args._page);
      const pageSize=Number(args._page_size);const items = collection === 'divergences' ? divergences.slice((page - 1) * pageSize, page * pageSize) : [];
      return { error: null, data: {
        version: 1, tenant_id: tenant, trip_id: trip, collection, page, page_size: pageSize,
        total_count: collection === 'divergences' ? 501 : 0, items,
      } };
    }
    throw new Error(`Unexpected RPC ${name}`);
  });
});

describe('paginated trip cargo snapshot reader', () => {
  it('pins offset pages to the first list revision',async()=>{const revision='a'.repeat(32),base={version:2,tenant_id:tenant,total_count:51,page:1,page_size:50,revision,items:[]};mock.rpc.mockResolvedValueOnce({error:null,data:base}).mockResolvedValueOnce({error:null,data:{...base,page:2}});await listTripCargoControls(tenant,null,1,50);await listTripCargoControls(tenant,null,2,50);expect(mock.rpc).toHaveBeenLastCalledWith('list_trip_cargo_controls_v2',{_tenant_id:tenant,_status:null,_page:2,_page_size:50,_expected_revision:revision});});
  it('loads only the first bounded page while preserving collection totals', async () => {
    const snapshot = await getTripCargoControl(tenant, trip);
    expect(snapshot.available).toBe(true);
    if (!snapshot.available) throw new Error('Expected available snapshot');
    expect(snapshot.divergences).toHaveLength(50);
    expect(snapshot.collection_counts.divergences).toBe(501);
    expect(mock.rpc.mock.calls.filter(([name, args]) => name === 'get_trip_cargo_collection_page_v1'
      && args._collection === 'divergences')).toHaveLength(1);
    await expect(getTripCargoCollectionPage(tenant,trip,'divergences',2,50,501)).resolves.toMatchObject({page:2,total:501,items:expect.any(Array)});
  });
});
