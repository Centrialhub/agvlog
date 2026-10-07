import { useEffect, useState } from 'react';
import type { Database } from '@/integrations/supabase/types';
import type { DriverTrip } from '@/lib/driverTrip';
import { readDriverRouteSnapshot, saveDriverRouteSnapshot } from '@/lib/driver/offlineRouteSnapshot';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';

type SnapshotDriver = Pick<Database['public']['Tables']['drivers']['Row'], 'id' | 'name'>;
type SnapshotStop = Database['public']['Tables']['dispatch_stops']['Row'] & {
  clients: { company_name: string } | null;
};

interface DriverStopsSnapshotScope {
  tenantId: string | undefined;
  userId: string | undefined;
  tripIdParam: string | null;
  activeTrip: DriverTrip | null | undefined;
  driver: SnapshotDriver | null | undefined;
  stops: SnapshotStop[];
  stopsIsError: boolean;
  stopsIsPending: boolean;
  routeError: unknown;
  routeDenied: boolean;
}

export function useDriverStopsSnapshots({
  tenantId, userId, tripIdParam, activeTrip, driver, stops,
  stopsIsError, stopsIsPending, routeError, routeDenied,
}: DriverStopsSnapshotScope) {
  const [cachedSnapshot, setCachedSnapshot] = useState(() => (
    readDriverRouteSnapshot(tenantId, userId)
  ));
  const [operationalSnapshot, setOperationalSnapshot] = useState<DriverOperationalSnapshot | null>(null);
  const [snapshotPending, setSnapshotPending] = useState(true);
  const cachedScopeMatches = !!cachedSnapshot && cachedSnapshot.tenantId === tenantId
    && cachedSnapshot.userId === userId && (!driver || cachedSnapshot.driver.id === driver.id);

  useEffect(() => {
    setCachedSnapshot(readDriverRouteSnapshot(tenantId, userId));
  }, [tenantId, userId]);

  useEffect(() => {
    let current = true;
    const snapshotTripId = tripIdParam ?? activeTrip?.id ?? (cachedScopeMatches ? cachedSnapshot?.trip.id : null);
    setOperationalSnapshot(null);
    if (routeDenied || !tenantId || !userId || !snapshotTripId) {
      setSnapshotPending(false);
      return () => { current = false; };
    }
    setSnapshotPending(true);
    void driverOperationalSnapshotStore.read(tenantId, userId, snapshotTripId)
      .then(snapshot => { if (current) setOperationalSnapshot(snapshot); })
      .catch(() => { if (current) setOperationalSnapshot(null); })
      .finally(() => { if (current) setSnapshotPending(false); });
    return () => { current = false; };
  }, [activeTrip?.id, cachedScopeMatches, cachedSnapshot?.trip.id, tenantId, routeDenied, tripIdParam, userId]);

  useEffect(() => {
    if (routeError || routeDenied || !tenantId || !userId || !driver || !activeTrip || stopsIsError || stopsIsPending) return;
    const savedSnapshot = saveDriverRouteSnapshot({
      tenantId: tenantId,
      userId: userId,
      driver: { id: driver.id, name: driver.name ?? 'Motorista' },
      trip: {
        id: activeTrip.id,
        status: activeTrip.status,
        actual_start_at: activeTrip.actual_start_at,
        loads: activeTrip.loads ? { load_number: activeTrip.loads.load_number } : null,
      },
      stops: stops.map((stop) => ({
        id: stop.id,
        stop_order: stop.stop_order,
        destination: stop.destination,
        status: stop.status,
        latitude: stop.latitude,
        longitude: stop.longitude,
        notes: stop.notes,
        actual_arrival_at: stop.actual_arrival_at,
        actual_departure_at: stop.actual_departure_at,
        clients: stop.clients ? { company_name: stop.clients.company_name } : null,
      })),
    });
    if (savedSnapshot) setCachedSnapshot(savedSnapshot);
  }, [activeTrip, tenantId, driver, routeDenied, routeError, stops, stopsIsError, stopsIsPending, userId]);

  useEffect(() => {
    if (routeError || routeDenied || !tenantId || !userId || !driver || !activeTrip || stopsIsError || stopsIsPending) return;
    let current = true;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(tenantId, userId, activeTrip.id);
      if (!current) return;
      const next: DriverOperationalSnapshot = {
        version: 1, tenantId: tenantId, actorId: userId, tripId: activeTrip.id, cachedAt: new Date().toISOString(),
        trip: { id: activeTrip.id, status: activeTrip.status, actualStartAt: activeTrip.actual_start_at,
          actualEndAt: activeTrip.actual_end_at ?? null, driver: { id: driver.id, name: driver.name ?? 'Motorista' },
          vehicle: activeTrip.vehicle_id ? { id: activeTrip.vehicle_id, plate: activeTrip.vehicles?.plate ?? '', nickname: activeTrip.vehicles?.nickname ?? null } : null },
        loads: activeTrip.loads ? [{ id: activeTrip.loads.id, loadNumber: activeTrip.loads.load_number,
          status: activeTrip.loads.status, origin: activeTrip.loads.origin, destination: activeTrip.loads.destination,
          volumeCount: existing?.loads.find(load => load.id === activeTrip.loads?.id)?.volumeCount ?? null,
          palletCount: existing?.loads.find(load => load.id === activeTrip.loads?.id)?.palletCount ?? null,
          weightKg: existing?.loads.find(load => load.id === activeTrip.loads?.id)?.weightKg ?? null }] : existing?.loads ?? [],
        stops: stops.map(stop => ({ id: stop.id, order: stop.stop_order ?? null, status: stop.status,
          destination: stop.destination ?? null, latitude: stop.latitude == null ? null : Number(stop.latitude),
          longitude: stop.longitude == null ? null : Number(stop.longitude), notes: stop.notes ?? null,
          client: stop.clients ? { id: stop.client_id ?? null, name: stop.clients.company_name } : null,
          actualArrivalAt: stop.actual_arrival_at ?? null, actualDepartureAt: stop.actual_departure_at ?? null })),
        documents: existing?.documents ?? [],
        deliveryItemsByStop: existing?.deliveryItemsByStop,
        instructions: [...new Set(stops.map(stop => stop.notes?.trim()).filter((note): note is string => !!note))],
        checklist: existing?.checklist ?? { pre: { id: null, boundaryId: null, checkedItems: [] }, post: { id: null, boundaryId: null, checkedItems: [] } },
        journey: existing?.journey ?? { events: [], lastStartId: null, lastEndId: null },
        occurrences: existing?.occurrences ?? [],
        cargo: existing?.cargo ?? null,
      };
      await driverOperationalSnapshotStore.put(next);
      if (current) setOperationalSnapshot(next);
    })().catch(() => { /* The scoped legacy route snapshot remains available offline. */ });
    return () => { current = false; };
  }, [activeTrip, tenantId, driver, routeDenied, routeError, stops, stopsIsError, stopsIsPending, userId]);

  return { cachedSnapshot, operationalSnapshot, snapshotPending, cachedScopeMatches };
}
