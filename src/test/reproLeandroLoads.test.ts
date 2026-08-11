import { describe, it, expect } from 'vitest';

type Driver = { id: string; user_id: string | null; active: boolean; tenant_id: string };
type DispatchTrip = { id: string; driver_id: string | null; tenant_id: string; status: string };
type Load = {
  id: string;
  load_number: string;
  driver_id: string | null;
  trip_id: string | null;
  status: string;
  on_hold?: boolean;
  tenant_id: string;
};

interface Fixture {
  authUid: string | null;
  currentTenantId: string | null;
  drivers: Driver[];
  trips: DispatchTrip[];
  loads: Load[];
}

function driverLoadIds(f: Fixture): Set<string> {
  // Simulating the DISTINCT and UNION from _driver_load_ids()
  // and the RLS policy "Drivers view own trip loads"
  const activeDriver = f.drivers.find((d) => d.user_id === f.authUid && d.active && d.tenant_id === f.currentTenantId);
  if (!activeDriver) return new Set();

  const ids = new Set<string>();

  for (const l of f.loads) {
    if (l.tenant_id !== f.currentTenantId || l.on_hold) continue;

    // Path B: load.trip_id -> trip.driver
    if (l.trip_id) {
        const trip = f.trips.find(t => t.id === l.trip_id);
        if (trip?.driver_id === activeDriver.id) {
            ids.add(l.id);
        }
    }
    
    // Path C: load.driver_id direct
    if (l.driver_id === activeDriver.id) {
        ids.add(l.id);
    }
  }
  return ids;
}

function driverTripIds(f: Fixture): Set<string> {
    const activeDriver = f.drivers.find((d) => d.user_id === f.authUid && d.active && d.tenant_id === f.currentTenantId);
    if (!activeDriver) return new Set();
    
    const ids = new Set<string>();
    for (const t of f.trips) {
        if (t.tenant_id === f.currentTenantId && t.driver_id === activeDriver.id) {
            ids.add(t.id);
        }
    }
    return ids;
}

describe('Reproduction: Leandro Load Visibility', () => {
    const driver: Driver = { 
        id: 'b0b8068e-b8bc-4f17-8a74-9701dcd8cc28', 
        user_id: '87873f27-3602-4f5c-8a27-191355c6e326', 
        active: true, 
        tenant_id: '6e874e6e-5bca-486d-9928-bef0646989c4' 
    };
    
    const trip: DispatchTrip = {
        id: '69383db8-43a5-46ae-8479-229a70f5a045',
        driver_id: driver.id,
        tenant_id: driver.tenant_id,
        status: 'planned'
    };
    
    const load: Load = {
        id: '0b988ce7-6be8-485c-bf1a-40cbb927bcea',
        load_number: '1004',
        driver_id: driver.id,
        trip_id: trip.id,
        status: 'ready',
        on_hold: false,
        tenant_id: driver.tenant_id
    };

    const fixture: Fixture = {
        authUid: driver.user_id,
        currentTenantId: driver.tenant_id,
        drivers: [driver],
        trips: [trip],
        loads: [load]
    };

    it('Driver should see the load', () => {
        const visibleLoads = driverLoadIds(fixture);
        expect(visibleLoads.has(load.id)).toBe(true);
    });

    it('Driver should see the trip', () => {
        const visibleTrips = driverTripIds(fixture);
        expect(visibleTrips.has(trip.id)).toBe(true);
    });
});
