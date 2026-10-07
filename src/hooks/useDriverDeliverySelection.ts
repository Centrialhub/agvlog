import type { DriverDeliveryItem } from '@/lib/driver/driverDeliveryItems';
import type { DriverDeliveryFiscalSnapshot } from '@/lib/driver/driverDeliveryFiscalSnapshot';
import { useEffect, useRef, useState } from 'react';
import { isStopTerminal } from '@/lib/status/stopStatus';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';
import type { DeliveryEventSelection, DriverStop } from '@/components/driver/deliveries/driverDeliveryEvents';

export type DeliveryTrip = {
  id: string;
  status: string;
  actual_start_at: string | null;
  actual_end_at?: string | null;
  loads: { id?: string; load_number: string; status?: string; origin?: string | null; destination?: string | null } | null;
};
export function stopFromSnapshot(snapshot: DriverOperationalSnapshot, stop: DriverOperationalSnapshot['stops'][number]): DriverStop {
  const now = snapshot.cachedAt;
  return {
    id: stop.id, tenant_id: snapshot.tenantId, dispatch_trip_id: snapshot.tripId,
    client_id: stop.client?.id ?? null, stop_order: stop.order ?? 0, status: stop.status,
    destination: stop.destination, latitude: stop.latitude, longitude: stop.longitude, notes: stop.notes,
    actual_arrival_at: stop.actualArrivalAt, actual_departure_at: stop.actualDepartureAt,
    created_at: now, updated_at: now, delivery_window_end: null, delivery_window_start: null,
    estimated_departure_at: null, planned_arrival_at: null, risk_level: null, risk_reason: null,
    service_time_minutes: null,
    clients: stop.client ? { company_name: stop.client.name, phone: null, mobile: null, email: null } : null,
    dispatch_stop_documents: [],
  };
}
export function tripFromSnapshot(snapshot: DriverOperationalSnapshot): DeliveryTrip {
  const load = snapshot.loads[0];
  return { id: snapshot.tripId, status: snapshot.trip.status, actual_start_at: snapshot.trip.actualStartAt,
    actual_end_at: snapshot.trip.actualEndAt, loads: load ? { id: load.id, load_number: load.loadNumber,
      status: load.status, origin: load.origin, destination: load.destination } : null };
}


type StopSelection = { stopId: string; context: string };
type FormSelection = StopSelection & { eventKey: string; lastKnownStop: DriverStop };
type Props = {
  scope: readonly (string | null | undefined)[];
  stops: DriverStop[];
  pendingStopIds: Set<string>;
  refreshing: boolean;
  error: boolean;
  authoritative: boolean;
  tripStarted: boolean;
};

export function useDriverDeliverySelection({ scope, stops, pendingStopIds, refreshing, error, authoritative, tripStarted }: Props) {
  const scopeKey = JSON.stringify(scope);
  const generation = useRef({ key: scopeKey, version: 0 });
  if (generation.current.key !== scopeKey) generation.current = { key: scopeKey, version: generation.current.version + 1 };
  // Returning to the same tenant/actor must not accept a response from an earlier visit.
  const context = JSON.stringify([scopeKey, generation.current.version]);
  const latestContext = useRef(context);
  latestContext.current = context;
  const [detailSelection, setDetailSelection] = useState<StopSelection | null>(null);
  const [catalogSelection, setCatalogSelection] = useState<StopSelection | null>(null);
  const [formSelection, setFormSelection] = useState<FormSelection | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);
  const pageHeading = useRef<HTMLHeadingElement | null>(null);

  const detailStop = detailSelection?.context === context
    ? stops.find(stop => stop.id === detailSelection.stopId) ?? null : null;
  const eventCatalogStop = catalogSelection?.context === context
    ? stops.find(stop => stop.id === catalogSelection.stopId) ?? null : null;
  const scopedForm = formSelection?.context === context ? formSelection : null;
  const formStop = scopedForm ? stops.find(stop => stop.id === scopedForm.stopId) : undefined;
  // Preserve proof fields when a stop disappears; its actions remain blocked by currentFormStop.
  const eventForm: DeliveryEventSelection | null = scopedForm
    ? { stop: formStop ?? scopedForm.lastKnownStop, eventKey: scopedForm.eventKey } : null;
  const currentFormStop = formStop && !pendingStopIds.has(formStop.id) ? formStop : undefined;
  const openSheets = useRef(false);
  openSheets.current = !!(detailStop || eventCatalogStop || eventForm);
  const latestState = useRef({ stops, pendingStopIds, refreshing, error, tripStarted });
  latestState.current = { stops, pendingStopIds, refreshing, error, tripStarted };

  useEffect(() => {
    latestContext.current = context;
    setDetailSelection(null); setCatalogSelection(null); setFormSelection(null);
    return () => { if (latestContext.current === context) latestContext.current = 'unmounted'; };
  }, [context]);
  useEffect(() => {
    if (!authoritative) return;
    if (detailSelection && !detailStop) setDetailSelection(null);
    if (catalogSelection && !eventCatalogStop) setCatalogSelection(null);
  }, [authoritative, catalogSelection, detailSelection, detailStop, eventCatalogStop]);

  const openDetail = (stop: DriverStop) => {
    returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    setDetailSelection({ stopId: stop.id, context });
  };
  const openCatalog = (stop: DriverStop) => {
    if (refreshing || error || pendingStopIds.has(stop.id) || isStopTerminal(stop.status)) return;
    setCatalogSelection({ stopId: stop.id, context }); setDetailSelection(null);
  };
  const selectEvent = (selection: DeliveryEventSelection) => {
    const stop = stops.find(item => item.id === selection.stop.id);
    if (!stop || refreshing || error || pendingStopIds.has(stop.id) || isStopTerminal(stop.status)) return false;
    setFormSelection({ stopId: stop.id, eventKey: selection.eventKey, context, lastKnownStop: stop });
    setDetailSelection(null); setCatalogSelection(null);
    return true;
  };
  const restoreFocus = (event: Event) => {
    event.preventDefault();
    if (openSheets.current) return;
    if (returnFocus.current?.isConnected) returnFocus.current.focus();
    else pageHeading.current?.focus();
  };
  const assertCurrentStop = (submittedContext: string, stopId: string | undefined, frozenRetry: boolean) => {
    const state = latestState.current;
    const stop = state.stops.find(item => item.id === stopId);
    if (submittedContext !== latestContext.current || (!frozenRetry && (!stop || isStopTerminal(stop.status)
      || state.pendingStopIds.has(stop.id) || state.refreshing || state.error || !state.tripStarted))) {
      throw new Error('A parada foi encerrada ou reatribuída. Atualize a viagem antes de enviar.');
    }
    return stop;
  };
  return { context, latestContext, detailStop, eventCatalogStop, eventForm, currentFormStop, pageHeading,
    openDetail, openCatalog, selectEvent, restoreFocus, assertCurrentStop,
    closeDetail: () => setDetailSelection(null), closeCatalog: () => setCatalogSelection(null), closeForm: () => setFormSelection(null) };
}

type SnapshotPersistenceProps = {
  tenantId: string | undefined;
  actorId: string | undefined;
  driver: { id: string; name: string } | null | undefined;
  trip: DeliveryTrip | null | undefined;
  stops: DriverStop[] | undefined;
  error: boolean;
  deliveryItems: Record<string, DriverDeliveryItem[]> | undefined;
  fiscalSnapshots: Record<string, DriverDeliveryFiscalSnapshot> | undefined;
  onSnapshot: (snapshot: DriverOperationalSnapshot) => void;
};
export function useDriverDeliverySnapshotPersistence({ tenantId, actorId, driver, trip, stops, error,
  deliveryItems, fiscalSnapshots, onSnapshot }: SnapshotPersistenceProps) {
  useEffect(() => {
    if (!tenantId || !actorId || !driver || !trip || !stops || error) return;
    let active = true;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(tenantId, actorId, trip.id);
      if (!active) return;
      const liveItems = deliveryItems;
      const next: DriverOperationalSnapshot = {
        version: 1, tenantId: tenantId, actorId: actorId, tripId: trip.id,
        cachedAt: new Date().toISOString(),
        trip: { id: trip.id, status: trip.status, actualStartAt: trip.actual_start_at,
          actualEndAt: trip.actual_end_at ?? null, driver: { id: driver.id, name: driver.name ?? 'Motorista' },
          vehicle: existing?.trip.vehicle ?? null },
        loads: existing?.loads ?? (trip.loads?.id ? [{ id: trip.loads.id,
          loadNumber: trip.loads.load_number, status: trip.loads.status ?? 'unknown',
          origin: trip.loads.origin ?? null, destination: trip.loads.destination ?? null,
          volumeCount: null, palletCount: null, weightKg: null }] : []),
        stops: stops.map(stop => ({ id: stop.id, order: stop.stop_order ?? null, status: stop.status,
          destination: stop.destination ?? null, latitude: stop.latitude == null ? null : Number(stop.latitude),
          longitude: stop.longitude == null ? null : Number(stop.longitude), notes: stop.notes ?? null,
          client: stop.clients ? { id: stop.client_id ?? null, name: stop.clients.company_name } : null,
          actualArrivalAt: stop.actual_arrival_at ?? null, actualDepartureAt: stop.actual_departure_at ?? null })),
        documents: existing?.documents ?? [],
        deliveryItemsByStop: liveItems ?? existing?.deliveryItemsByStop,
        deliveryFiscalSnapshotsByStop: fiscalSnapshots ?? existing?.deliveryFiscalSnapshotsByStop,
        instructions: [...new Set(stops.map(stop => stop.notes?.trim()).filter((note): note is string => !!note))],
        checklist: existing?.checklist ?? { pre: { id: null, boundaryId: null, checkedItems: [] },
          post: { id: null, boundaryId: null, checkedItems: [] } },
        journey: existing?.journey ?? { events: [], lastStartId: null, lastEndId: null },
        occurrences: existing?.occurrences ?? [],
        cargo: existing?.cargo ?? null,
      };
      await driverOperationalSnapshotStore.put(next);
      if (active) onSnapshot(next);
    })().catch(() => { /* Live reads remain usable even when IndexedDB is unavailable. */ });
    return () => { active = false; };
  }, [tenantId, actorId, driver, trip, stops, error, deliveryItems, fiscalSnapshots, onSnapshot]);
}
