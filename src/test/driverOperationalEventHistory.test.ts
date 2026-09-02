import { describe, expect, it } from 'vitest';
import {
  mergeDriverOperationalEventPages,
  parseDriverOperationalEventPage,
  type DriverOperationalEventPage,
} from '@/lib/driver/driverOperationalEventHistory';

const tenant = '74000000-0000-4000-8000-000000000001';
const actor = '74000000-0000-4000-8000-000000000002';
const driver = '74000000-0000-4000-8000-000000000003';
const trip = '74000000-0000-4000-8000-000000000004';
const id = '74000000-0000-4000-8000-000000000011';
const created = '2026-09-02T00:00:00.000Z';
const item = {
  id,
  tenant_id: tenant,
  driver_id: driver,
  dispatch_trip_id: trip,
  dispatch_stop_id: null,
  event_type: 'other',
  severity: 'low',
  description: 'Cliente pediu nova previsão.',
  report_details: { label: 'OTHE', stop_name: 'Cliente Sul' },
  payload: { scope: 'stop' },
  created_at: created,
};
const cursor = {
  scope: 'b'.repeat(64),
  snapshot_at: '2026-09-02T01:00:00.000Z',
  created_at: created,
  id,
};
const page = (items = [item], next: typeof cursor | null = null): DriverOperationalEventPage => ({
  version: 1,
  tenant_id: tenant,
  actor_id: actor,
  driver_id: driver,
  trip_id: trip,
  items,
  next_cursor: next,
});

describe('driver operational-event history response boundary', () => {
  it('accepts the exact actor, driver and trip envelope', () => {
    expect(parseDriverOperationalEventPage(page(), {
      tenantId: tenant, actorId: actor, driverId: driver, tripId: trip,
    }).items[0]).toEqual(item);
  });

  it('fails closed on another tenant/session/trip or an unrelated cursor', () => {
    const expected = { tenantId: tenant, actorId: actor, driverId: driver, tripId: trip };
    expect(() => parseDriverOperationalEventPage({ ...page(), actor_id: id }, expected)).toThrow('sessão');
    expect(() => parseDriverOperationalEventPage({ ...page(), trip_id: null }, expected)).toThrow('viagem');
    expect(() => parseDriverOperationalEventPage({ ...page(), items: [{ ...item, tenant_id: actor }] }, expected)).toThrow('outra empresa');
    expect(() => parseDriverOperationalEventPage(page([item], { ...cursor, id: actor }), expected)).toThrow('cursor');
  });

  it('rejects duplicate rows across cursor pages', () => {
    expect(() => mergeDriverOperationalEventPages([page(), page()])).toThrow('duplicados');
  });
});
