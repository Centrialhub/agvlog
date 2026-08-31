import { describe, expect, it } from 'vitest';
import {
  hasDriverLoadTransitMismatch,
  isDriverTripStarted,
  normalizeDriverTrip,
  resolveCanonicalTripLink,
  type DriverTripQueryRow,
} from '@/lib/driverTrip';

const baseTrip: Omit<DriverTripQueryRow, 'dispatch_trip_loads'> = {
  id: 'trip-1',
  tenant_id: 'tenant-1',
  driver_id: 'driver-1',
  vehicle_id: null,
  load_id: null,
  status: 'in_transit',
  notes: null,
  planned_start_at: null,
  planned_end_at: null,
  actual_start_at: null,
  actual_end_at: null,
  created_by: null,
  created_at: '2026-08-26T00:00:00Z',
  updated_at: '2026-08-26T00:00:00Z',
  vehicles: null,
};

describe('driver trip canonical load relation', () => {
  it('uses dispatch_trip_loads when the legacy load_id is absent', () => {
    const trip = normalizeDriverTrip({
      ...baseTrip,
      dispatch_trip_loads: [{
        load_id: 'load-1',
        loads: {
          id: 'load-1',
          load_number: '1003',
          origin: 'Montes Claros',
          destination: 'Januária',
          status: 'in_transit',
        },
      }],
    });

    expect(trip.loads?.id).toBe('load-1');
    expect(trip.loads?.load_number).toBe('1003');
  });

  it('selects the canonical link matching the legacy primary load when present', () => {
    const trip = normalizeDriverTrip({
      ...baseTrip,
      load_id: 'load-2',
      dispatch_trip_loads: [
        {
          load_id: 'load-1',
          loads: { id: 'load-1', load_number: '1003', origin: null, destination: null, status: 'in_transit' },
        },
        {
          load_id: 'load-2',
          loads: { id: 'load-2', load_number: '1012', origin: null, destination: null, status: 'in_transit' },
        },
      ],
    });

    expect(trip.loads?.id).toBe('load-2');
  });

  it('returns an explicit null load when no canonical link exists', () => {
    const trip = normalizeDriverTrip({ ...baseTrip, load_id: 'legacy-only', dispatch_trip_loads: [] });

    expect(trip.loads).toBeNull();
  });

  it('resolves the active trip from canonical load links', () => {
    const link = resolveCanonicalTripLink([
      { dispatch_trip_id: 'finished-trip', dispatch_trips: { status: 'completed' } },
      { dispatch_trip_id: 'active-trip', dispatch_trips: { status: 'in_transit' } },
    ], ['planned', 'in_transit']);

    expect(link?.dispatch_trip_id).toBe('active-trip');
  });

  it('requires both a started status and actual start timestamp', () => {
    expect(isDriverTripStarted('in_transit', '2026-08-29T12:00:00Z')).toBe(true);
    expect(isDriverTripStarted('in_progress', '2026-08-29T12:00:00Z')).toBe(true);
    expect(isDriverTripStarted('in_transit', null)).toBe(false);
    expect(isDriverTripStarted('in_transit')).toBe(false);
    expect(isDriverTripStarted('planned', null)).toBe(false);
  });

  it('flags an in-transit load whose trip was not started', () => {
    expect(hasDriverLoadTransitMismatch('in_transit', {
      dispatch_trip_id: 'trip-1',
      dispatch_trips: { status: 'planned', actual_start_at: null },
    })).toBe(true);
    expect(hasDriverLoadTransitMismatch('in_transit', {
      dispatch_trip_id: 'trip-1',
      dispatch_trips: { status: 'in_transit', actual_start_at: '2026-08-29T12:00:00Z' },
    })).toBe(false);
  });
});
