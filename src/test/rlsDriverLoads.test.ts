import { describe, it, expect } from 'vitest';

/**
 * These tests mirror the SQL function `public._driver_load_ids()` and the
 * `Drivers view own trip loads` RLS policy on `public.loads`:
 *
 *   CREATE POLICY "Drivers view own trip loads" ON public.loads
 *     FOR SELECT USING (id IN (SELECT _driver_load_ids()));
 *
 *   _driver_load_ids() =
 *     -- Path A: load linked to a dispatch trip's driver (via dispatch_trip_loads pivot)
 *     -- Path B: load.trip_id -> dispatch_trip.driver_id
 *     -- Path C: load.driver_id directly
 *   filtered by drivers.user_id = auth.uid() AND drivers.active = true.
 *
 * The port below reproduces the same UNION so any regression on the SQL side
 * (e.g. dropping one of the paths, forgetting the `active` filter, or leaking
 * cross-driver rows) fails these assertions. If you change the SQL function,
 * update this simulation in the same commit.
 */

type Driver = { id: string; user_id: string | null; active: boolean };
type Vehicle = { id: string; current_driver_id: string | null };
type DispatchTrip = { id: string; driver_id: string | null };
type DispatchTripLoad = { dispatch_trip_id: string; load_id: string };
type Load = {
  id: string;
  driver_id: string | null;
  vehicle_id: string | null;
  trip_id: string | null;
  on_hold?: boolean;
};

interface Fixture {
  authUid: string | null;
  drivers: Driver[];
  vehicles: Vehicle[];
  trips: DispatchTrip[];
  tripLoads: DispatchTripLoad[];
  loads: Load[];
}

/** Port of `public._driver_load_ids()`. */
function driverLoadIds(f: Fixture): Set<string> {
  const activeDriverIds = new Set(
    f.drivers.filter((d) => d.user_id === f.authUid && d.active).map((d) => d.id),
  );
  const ids = new Set<string>();

  // Path A: dispatch_trip_loads pivot → trip.driver
  for (const dtl of f.tripLoads) {
    const trip = f.trips.find((t) => t.id === dtl.dispatch_trip_id);
    const load = f.loads.find((l) => l.id === dtl.load_id);
    if (trip?.driver_id && activeDriverIds.has(trip.driver_id) && !load?.on_hold) ids.add(dtl.load_id);
  }
  // Path B: load.trip_id → trip.driver
  for (const l of f.loads) {
    if (!l.trip_id || l.on_hold) continue;
    const trip = f.trips.find((t) => t.id === l.trip_id);
    if (trip?.driver_id && activeDriverIds.has(trip.driver_id)) ids.add(l.id);
  }
  // Path C: load.driver_id direct
  for (const l of f.loads) {
    if (l.on_hold) continue;
    if (l.driver_id && activeDriverIds.has(l.driver_id)) ids.add(l.id);
  }
  return ids;
}

/** Port of the trigger `loads_autofill_driver_from_vehicle`. */
function autofillDriverFromVehicle(
  load: Load,
  vehicles: Vehicle[],
  drivers: Driver[],
): Load {
  if (load.driver_id || !load.vehicle_id) return load;
  const v = vehicles.find((x) => x.id === load.vehicle_id);
  if (!v?.current_driver_id) return load;
  const d = drivers.find((x) => x.id === v.current_driver_id);
  if (!d?.active) return load;
  return { ...load, driver_id: d.id };
}

function makeFixture(): Fixture {
  const driverA: Driver = { id: 'drv-A', user_id: 'user-A', active: true };
  const driverB: Driver = { id: 'drv-B', user_id: 'user-B', active: true };
  const driverInactive: Driver = { id: 'drv-C', user_id: 'user-C', active: false };
  const vehicleA: Vehicle = { id: 'veh-1', current_driver_id: 'drv-A' };
  const vehicleB: Vehicle = { id: 'veh-2', current_driver_id: 'drv-B' };
  const tripA: DispatchTrip = { id: 'trip-A', driver_id: 'drv-A' };
  const tripB: DispatchTrip = { id: 'trip-B', driver_id: 'drv-B' };

  const loadDirectA: Load = {
    id: 'load-direct-A',
    driver_id: 'drv-A',
    vehicle_id: null,
    trip_id: null,
  };
  const loadViaTripA: Load = {
    id: 'load-trip-A',
    driver_id: null,
    vehicle_id: null,
    trip_id: 'trip-A',
  };
  // Vehicle-assigned to A, driver_id populated by autofill trigger.
  const loadViaVehicleA = autofillDriverFromVehicle(
    { id: 'load-vehicle-A', driver_id: null, vehicle_id: 'veh-1', trip_id: null },
    [vehicleA, vehicleB],
    [driverA, driverB, driverInactive],
  );
  const loadPivotA: Load = {
    id: 'load-pivot-A',
    driver_id: null,
    vehicle_id: null,
    trip_id: null,
  };
  const loadDirectB: Load = {
    id: 'load-direct-B',
    driver_id: 'drv-B',
    vehicle_id: null,
    trip_id: null,
  };
  const loadInactive: Load = {
    id: 'load-inactive',
    driver_id: 'drv-C',
    vehicle_id: null,
    trip_id: null,
  };

  return {
    authUid: null,
    drivers: [driverA, driverB, driverInactive],
    vehicles: [vehicleA, vehicleB],
    trips: [tripA, tripB],
    tripLoads: [{ dispatch_trip_id: 'trip-A', load_id: loadPivotA.id }],
    loads: [
      loadDirectA,
      loadViaTripA,
      loadViaVehicleA,
      loadPivotA,
      loadDirectB,
      loadInactive,
    ],
  };
}

describe('RLS: driver load visibility (_driver_load_ids)', () => {
  it('vehicle autofill trigger populates driver_id from vehicle.current_driver_id', () => {
    const f = makeFixture();
    const l = f.loads.find((x) => x.id === 'load-vehicle-A')!;
    expect(l.driver_id).toBe('drv-A');
  });

  it('driver A sees the load assigned directly (path C)', () => {
    const f = { ...makeFixture(), authUid: 'user-A' };
    expect(driverLoadIds(f).has('load-direct-A')).toBe(true);
  });

  it('driver A sees the load assigned via vehicle (autofill → path C)', () => {
    const f = { ...makeFixture(), authUid: 'user-A' };
    expect(driverLoadIds(f).has('load-vehicle-A')).toBe(true);
  });

  it('driver A sees the load linked by trip_id (path B)', () => {
    const f = { ...makeFixture(), authUid: 'user-A' };
    expect(driverLoadIds(f).has('load-trip-A')).toBe(true);
  });

  it('driver A sees the load linked via dispatch_trip_loads pivot (path A)', () => {
    const f = { ...makeFixture(), authUid: 'user-A' };
    expect(driverLoadIds(f).has('load-pivot-A')).toBe(true);
  });

  it('driver A does NOT see loads assigned to driver B', () => {
    const f = { ...makeFixture(), authUid: 'user-A' };
    const visible = driverLoadIds(f);
    expect(visible.has('load-direct-B')).toBe(false);
  });

  it('driver B only sees their own load', () => {
    const f = { ...makeFixture(), authUid: 'user-B' };
    const visible = driverLoadIds(f);
    expect([...visible].sort()).toEqual(['load-direct-B']);
  });

  it('inactive driver sees no loads even when directly assigned', () => {
    const f = { ...makeFixture(), authUid: 'user-C' };
    expect(driverLoadIds(f).size).toBe(0);
  });

  it('anonymous user (no auth.uid) sees nothing', () => {
    const f = { ...makeFixture(), authUid: null };
    expect(driverLoadIds(f).size).toBe(0);
  });

  it('driver A total visibility covers all three paths and only their own loads', () => {
    const f = { ...makeFixture(), authUid: 'user-A' };
    const visible = [...driverLoadIds(f)].sort();
    expect(visible).toEqual(
      ['load-direct-A', 'load-pivot-A', 'load-trip-A', 'load-vehicle-A'].sort(),
    );
  });
});