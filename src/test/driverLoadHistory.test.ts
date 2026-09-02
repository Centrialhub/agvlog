import { describe, expect, it } from 'vitest';
import {
  mergeDriverLoadHistoryPages,
  parseDriverLoadHistoryPage,
  type DriverLoadHistoryPage,
} from '@/lib/driver/driverLoadHistory';

const tenant = '71000000-0000-4000-8000-000000000001';
const actor = '71000000-0000-4000-8000-000000000002';
const driver = '71000000-0000-4000-8000-000000000003';
const id = '71000000-0000-4000-8000-000000000011';
const created = '2026-09-01T20:00:00.000Z';
const item = {
  id,
  tenant_id: tenant,
  load_number: '1012',
  origin: 'Montes Claros',
  destination: 'Belo Horizonte',
  status: 'in_transit' as const,
  scheduled_load_at: null,
  total_pallet_count: 10,
  total_weight_kg: 450,
  created_at: created,
  vehicles: { plate: 'AAA1A11', nickname: null },
  dispatch_trip_loads: [{
    dispatch_trip_id: '71000000-0000-4000-8000-000000000021',
    dispatch_trips: { status: 'in_transit', actual_start_at: created },
  }],
};
const cursor = {
  scope: 'a'.repeat(64),
  snapshot_at: '2026-09-01T21:00:00.000Z',
  created_at: created,
  id,
};
const page = (items = [item], next: typeof cursor | null = null): DriverLoadHistoryPage => ({
  version: 1,
  tenant_id: tenant,
  actor_id: actor,
  driver_id: driver,
  search: null,
  status: null,
  items,
  next_cursor: next,
});

describe('driver load history response boundary', () => {
  it('accepts the exact actor/driver/filter envelope and canonical trip data', () => {
    expect(parseDriverLoadHistoryPage(page(), {
      tenantId: tenant, actorId: actor, driverId: driver, search: null, status: null,
    }).items[0]).toEqual(item);
  });

  it('fails closed on another tenant/session/filter or an unrelated cursor', () => {
    const expected = { tenantId: tenant, actorId: actor, driverId: driver, search: null, status: null } as const;
    expect(() => parseDriverLoadHistoryPage({ ...page(), actor_id: id }, expected)).toThrow('sessão');
    expect(() => parseDriverLoadHistoryPage({ ...page(), search: '1012' }, expected)).toThrow('filtros');
    expect(() => parseDriverLoadHistoryPage({ ...page(), items: [{ ...item, tenant_id: actor }] }, expected)).toThrow('outra empresa');
    expect(() => parseDriverLoadHistoryPage(page([item], { ...cursor, id: actor }), expected)).toThrow('cursor');
  });

  it('rejects duplicate rows across cursor pages', () => {
    expect(() => mergeDriverLoadHistoryPages([page(), page()])).toThrow('duplicados');
  });
});
