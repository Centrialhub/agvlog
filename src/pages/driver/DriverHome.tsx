import { useQuery, useQueryClient as useTanstackQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { useDriverHomeVehiclePosition } from '@/hooks/useDriverHomeVehiclePosition';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Card, CardContent } from '@/components/ui/card';
import { useNavigate } from 'react-router-dom';
import NoLoadsHelp from '@/components/driver/NoLoadsHelp';
import { useEffect, useState } from 'react';
import { type DeliveryPoint } from '@/components/driver/DriverDeliveryMap';
import {
  DriverHomeChecklistAlert,
  DriverHomeDeliveryMap,
  DriverHomeLoadError,
  DriverHomeQuickActions,
  DriverHomeVehiclePositionError,
} from '@/components/driver/DriverHomePanels';
import { TRIP_ACTIVE_STATUSES, LOAD_ACTIVE_STATUSES } from '@/lib/status';
import { TERMINAL_LOAD_STATUSES } from '@/lib/status/loadStatus';
import { useDriverTripActions } from '@/hooks/useDriverTripActions';
import { DRIVER_TRIP_SELECT, normalizeDriverTrip, resolveCanonicalTripLink, type DriverTrip } from '@/lib/driverTrip';
import { NextDestinationCard } from '@/components/driver/NextDestinationCard';
import { getNextDriverStop, getPendingDriverStops, readDriverRouteSnapshot, saveDriverRouteSnapshot } from '@/lib/driver/offlineRouteSnapshot';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';
import {useDriverPhysicalJourney} from '@/hooks/useDriverPhysicalJourney';
import { isStopTerminal } from '@/lib/status/stopStatus';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import type { DriverHomeAssignedLoad } from '@/lib/driver/driverHomeTypes';
import { hasValidGeographicCoordinates } from '@/lib/maps/coordinates';
import { DriverHomeTripLists } from '@/components/driver/DriverHomeTripLists';

export default function DriverHome() {
  const driverQuery = useCurrentDriver();
  const { data: tenantDriver, isLoading: driverLoading } = driverQuery;
  const physicalJourneyQuery = useDriverPhysicalJourney();
  const {data:physicalJourney,isLoading:physicalJourneyLoading}=physicalJourneyQuery;
  const driver=tenantDriver??physicalJourney?.driver??null;
  const multiTenantJourney=Boolean(physicalJourney?.has_active_journey&&new Set(physicalJourney.trips.map(trip=>trip.tenant_id)).size>1);
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const isOnline = useOnlineStatus();
  const navigate = useNavigate();
  const queryClient = useTanstackQueryClient();
  const { accessTrip, isStartingTrip } = useDriverTripActions();
  const {
    data: autoTrip,
    isLoading: autoTripLoading,
    isError: autoTripFailed,
    error: autoTripError,
    refetch: refetchAutoTrip,
  } = useActiveTrip(driver?.id);
  const checklist = useChecklistStatus(autoTrip?.id);
  const {
    data: activeTrips = [],
    isLoading: tripsLoading,
    isError: tripsFailed,
    error: tripsError,
    refetch: refetchTrips,
  } = useQuery({
    queryKey: ['driver_my_trips', currentTenant?.id, user?.id, driver?.id, autoTrip?.id, physicalJourney?.journey?.id, multiTenantJourney],
    queryFn: async () => {
      if (!driver || !currentTenant || !user) return [];
      if (multiTenantJourney) return physicalJourney!.trips as unknown as DriverTrip[];
      
      // If we already have an autoTrip from the hook, use it as the primary
      if (autoTrip) {
        return [autoTrip];
      }

      const { data, error } = await supabase
        .from('dispatch_trips')
        .select(DRIVER_TRIP_SELECT)
        .eq('tenant_id', currentTenant.id)
        .eq('driver_id', driver.id)
        .order('created_at', { ascending: false })
        .limit(10);
        
      if (error) throw error;
      if (!data) return [];

      return data.map(normalizeDriverTrip).filter(trip =>
        (trip.status && (TRIP_ACTIVE_STATUSES as readonly string[]).includes(trip.status)) ||
        (trip.loads?.status && (LOAD_ACTIVE_STATUSES as readonly string[]).includes(trip.loads.status))
      ).slice(0, 5);
    },
    enabled: !!driver && !!currentTenant && !!user && !physicalJourneyLoading,
  });

  const {
    data: myLoads = [],
    isLoading: loadsLoading,
    isError: loadsFailed,
    error: loadsError,
    refetch: refetchLoads,
  } = useQuery({
    queryKey: ['driver_my_loads', currentTenant?.id, user?.id, driver?.id, physicalJourney?.journey?.id, multiTenantJourney],
    queryFn: async () => {
      if (!driver || !currentTenant || !user) return [];
      if (multiTenantJourney) return [];
      return fetchAllPostgrestPages<DriverHomeAssignedLoad>(async (from, to) => {
        const { data, error } = await supabase
          .from('loads')
          .select(`
            id,
            load_number,
            origin,
            destination,
            status,
            total_pallet_count,
            total_weight_kg,
            scheduled_load_at,
            vehicles(plate, nickname),
            dispatch_trip_loads!dispatch_trip_loads_load_id_fkey(
              dispatch_trip_id,
              dispatch_trips!dispatch_trip_loads_dispatch_trip_id_fkey(status)
            )
          `)
          .eq('tenant_id', currentTenant.id)
          .eq('driver_id', driver.id)
          .not('status', 'in', `(${TERMINAL_LOAD_STATUSES.join(',')})`)
          .order('created_at', { ascending: false })
          .order('id', { ascending: false })
          .range(from, to);
        return { data: (data || []) as unknown as DriverHomeAssignedLoad[], error };
      }, 100);
    },
    enabled: !!driver && !!currentTenant && !!user && !physicalJourneyLoading,
  });

  const primaryTrip = activeTrips[0];
  const homeStopsQuery = useQuery({
    queryKey: ['driver_home_stops', currentTenant?.id, user?.id, primaryTrip?.id, physicalJourney?.journey?.id, multiTenantJourney],
    queryFn: async () => {
      if (!primaryTrip?.id || !currentTenant || !user) return [];
      if(multiTenantJourney)return physicalJourney!.stops.filter(stop=>stop.dispatch_trip_id===primaryTrip.id);
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('id, stop_order, destination, status, latitude, longitude, notes, client_id, actual_arrival_at, actual_departure_at, clients(company_name)')
        .eq('tenant_id', currentTenant.id)
        .eq('dispatch_trip_id', primaryTrip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!primaryTrip?.id && !!currentTenant && !!user,
  });
  const { data: realStops = [] } = homeStopsQuery;
  const routeTenantId = primaryTrip?.tenant_id ?? currentTenant?.id;
  const {
    data: vehiclePos,
    isError: vehiclePositionFailed,
    isFetching: vehiclePositionFetching,
    refetch: refetchVehiclePosition,
  } = useDriverHomeVehiclePosition(primaryTrip?.vehicle_id, routeTenantId);

  useEffect(() => {
    if (!driver?.id || !currentTenant?.id || !user?.id) return undefined;
    const tripsKey = ['driver_my_trips', currentTenant.id, user.id, driver.id] as const;
    const loadsKey = ['driver_my_loads', currentTenant.id, user.id, driver.id] as const;
    const channel = supabase
      .channel(`driver_home_${currentTenant.id}_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loads', filter: `driver_id=eq.${driver.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: loadsKey });
          queryClient.invalidateQueries({ queryKey: tripsKey });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_trips', filter: `driver_id=eq.${driver.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: tripsKey });
          queryClient.invalidateQueries({ queryKey: loadsKey });
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          queryClient.invalidateQueries({ queryKey: loadsKey });
          queryClient.invalidateQueries({ queryKey: tripsKey });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [currentTenant?.id, driver?.id, queryClient, user?.id]);

  // Loads without an associated trip (driver assigned directly but no dispatch yet).
  const tripLoadIds = new Set(
    activeTrips
      .map((activeTrip) => activeTrip.loads?.id || activeTrip.load_id)
      .filter((id): id is string => Boolean(id)),
  );
  // Filtra cargas que não estão em uma viagem ativa mas estão atribuídas ao motorista
  const standaloneLoads = myLoads.filter((load) =>
    !resolveCanonicalTripLink(load.dispatch_trip_loads, TRIP_ACTIVE_STATUSES) && !tripLoadIds.has(load.id)
  );

  const loading = driverLoading || physicalJourneyLoading || autoTripLoading || tripsLoading || loadsLoading || homeStopsQuery.isLoading;
  const dataError = driverQuery.error ?? physicalJourneyQuery.error ?? autoTripError ?? tripsError ?? loadsError ?? homeStopsQuery.error;
  const hasDataError = driverQuery.isError || physicalJourneyQuery.isError || autoTripFailed || tripsFailed || loadsFailed || homeStopsQuery.isError;
  const dataErrorMessage = dataError instanceof Error
    ? dataError.message
    : 'Não foi possível carregar a viagem e as cargas do motorista.';
  
  // Inclui também viagens onde a carga associada está em estados operacionais
  const tripsToShow = activeTrips.filter((activeTrip) =>
    (TRIP_ACTIVE_STATUSES as readonly string[]).includes(activeTrip.status) ||
    (activeTrip.loads?.status && (LOAD_ACTIVE_STATUSES as readonly string[]).includes(activeTrip.loads.status))
  );

  // Constrói pontos reais do mapa a partir das paradas com lat/lng.
  const realMapStops: DeliveryPoint[] = realStops
    .filter((stop) => stop.latitude != null && stop.longitude != null &&
      hasValidGeographicCoordinates(Number(stop.latitude), Number(stop.longitude)))
    .map((stop, index) => ({
      id: stop.id,
      name: stop.clients?.company_name || stop.destination || `Parada ${index + 1}`,
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
      status: isStopTerminal(stop.status)
        ? 'done'
        : stop.status === 'arrived'
          ? 'current'
          : 'pending',
      sequence: stop.stop_order ?? index,
    }));
  const realVehicle =
    vehiclePos && vehiclePos.lat != null && vehiclePos.lng != null &&
      hasValidGeographicCoordinates(Number(vehiclePos.lat), Number(vehiclePos.lng))
      ? { lat: Number(vehiclePos.lat), lng: Number(vehiclePos.lng), plate: primaryTrip?.vehicles?.plate || '' }
      : null;
  const showRealMap = realMapStops.length > 0;
  const [cachedSnapshot, setCachedSnapshot] = useState(() => readDriverRouteSnapshot(routeTenantId, user?.id));

  useEffect(() => {
    setCachedSnapshot(readDriverRouteSnapshot(routeTenantId, user?.id));
  }, [routeTenantId, user?.id]);

  useEffect(() => {
    if (!routeTenantId || !user?.id || !driver || !primaryTrip || homeStopsQuery.isError || homeStopsQuery.isPending) return;
    const savedSnapshot = saveDriverRouteSnapshot({
      tenantId: routeTenantId,
      userId: user.id,
      driver: { id: driver.id, name: driver.name },
      trip: {
        id: primaryTrip.id,
        status: primaryTrip.status,
        actual_start_at: primaryTrip.actual_start_at ?? null,
        loads: primaryTrip.loads ? { load_number: primaryTrip.loads.load_number } : null,
      },
      stops: realStops.map((stop) => ({
        id: stop.id,
        stop_order: stop.stop_order,
        destination: stop.destination,
        status: stop.status,
        latitude: stop.latitude == null ? null : Number(stop.latitude),
        longitude: stop.longitude == null ? null : Number(stop.longitude),
        notes: stop.notes,
        clients: stop.clients ? { company_name: stop.clients.company_name } : null,
      })),
    });
    if (savedSnapshot) setCachedSnapshot(savedSnapshot);
  }, [routeTenantId, driver, homeStopsQuery.isError, homeStopsQuery.isPending, primaryTrip, realStops, user?.id]);

  useEffect(() => {
    if (!routeTenantId || !user?.id || !driver || !primaryTrip || homeStopsQuery.isError || homeStopsQuery.isPending) return;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(routeTenantId, user.id, primaryTrip.id);
      const liveLoad = myLoads.find(load => load.id === primaryTrip.loads?.id);
      const next: DriverOperationalSnapshot = {
        version: 1, tenantId: routeTenantId, actorId: user.id, tripId: primaryTrip.id, cachedAt: new Date().toISOString(),
        trip: { id: primaryTrip.id, status: primaryTrip.status, actualStartAt: primaryTrip.actual_start_at ?? null,
          actualEndAt: primaryTrip.actual_end_at ?? null, driver: { id: driver.id, name: driver.name },
          vehicle: primaryTrip.vehicle_id ? { id: primaryTrip.vehicle_id, plate: primaryTrip.vehicles?.plate ?? '', nickname: primaryTrip.vehicles?.nickname ?? null } : null },
        loads: primaryTrip.loads ? [{ id: primaryTrip.loads.id, loadNumber: primaryTrip.loads.load_number,
          status: primaryTrip.loads.status, origin: primaryTrip.loads.origin, destination: primaryTrip.loads.destination,
          volumeCount: existing?.loads.find(load => load.id === primaryTrip.loads?.id)?.volumeCount ?? null,
          palletCount: liveLoad?.total_pallet_count == null ? existing?.loads.find(load => load.id === primaryTrip.loads?.id)?.palletCount ?? null : Number(liveLoad.total_pallet_count),
          weightKg: liveLoad?.total_weight_kg == null ? existing?.loads.find(load => load.id === primaryTrip.loads?.id)?.weightKg ?? null : Number(liveLoad.total_weight_kg) }] : existing?.loads ?? [],
        stops: realStops.map(stop => ({ id: stop.id, order: stop.stop_order ?? null, status: stop.status,
          destination: stop.destination ?? null, latitude: stop.latitude == null ? null : Number(stop.latitude),
          longitude: stop.longitude == null ? null : Number(stop.longitude), notes: stop.notes ?? null,
          client: stop.clients ? { id: typeof stop.client_id === 'string' ? stop.client_id : null, name: stop.clients.company_name } : null,
          actualArrivalAt: typeof stop.actual_arrival_at === 'string' ? stop.actual_arrival_at : null,
          actualDepartureAt: typeof stop.actual_departure_at === 'string' ? stop.actual_departure_at : null })),
        documents: existing?.documents ?? [],
        deliveryItemsByStop: existing?.deliveryItemsByStop,
        instructions: [...new Set(realStops.map(stop => stop.notes?.trim()).filter((note): note is string => !!note))],
        checklist: existing?.checklist ?? { pre: { id: null, boundaryId: null, checkedItems: [] }, post: { id: null, boundaryId: null, checkedItems: [] } },
        journey: existing?.journey ?? { events: [], lastStartId: null, lastEndId: null },
        occurrences: existing?.occurrences ?? [],
        cargo: existing?.cargo ?? null,
      };
      await driverOperationalSnapshotStore.put(next);
    })().catch(() => { /* The live home screen does not depend on offline cache availability. */ });
  }, [driver, homeStopsQuery.isError, homeStopsQuery.isPending, myLoads, primaryTrip, realStops, routeTenantId, user?.id]);

  const cachedRouteMatches = !!cachedSnapshot && (!primaryTrip || cachedSnapshot.trip.id === primaryTrip.id);
  const useCachedRoute = cachedRouteMatches && (!primaryTrip || homeStopsQuery.isError || !isOnline);
  const destinationStops = useCachedRoute ? cachedSnapshot?.stops ?? [] : realStops.map(stop => ({
    ...stop,
    latitude: stop.latitude == null ? null : Number(stop.latitude),
    longitude: stop.longitude == null ? null : Number(stop.longitude),
  }));
  const nextStop = getNextDriverStop(destinationStops);
  const pendingStops = getPendingDriverStops(destinationStops);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Olá, {driver?.name || cachedSnapshot?.driver.name || 'Motorista'}</h1>
        <p className="text-sm text-muted-foreground">Seu roteiro de hoje</p>
      </div>

      {multiTenantJourney?(
        <Card className="border-primary/30 bg-primary/5">
          <CardContent className="p-3">
            <p className="text-sm font-medium">Jornada compartilhada entre empresas</p>
            <p className="text-xs text-muted-foreground">As {physicalJourney?.trips.length ?? 0} viagens aparecem em uma rota física; documentos e confirmações continuam vinculados à empresa correta.</p>
          </CardContent>
        </Card>
      ):null}

      {nextStop && (
        <NextDestinationCard
          stop={nextStop}
          remainingStops={pendingStops.length}
          offline={useCachedRoute}
        />
      )}

      {!loading && hasDataError && (
        <DriverHomeLoadError message={dataErrorMessage} onRetry={() => {
          void refetchAutoTrip();
          void refetchTrips();
          void refetchLoads();
          void driverQuery.refetch();
          void physicalJourneyQuery.refetch();
          void homeStopsQuery.refetch();
        }} />
      )}

      {!loading && primaryTrip?.vehicle_id && vehiclePositionFailed && (
        <DriverHomeVehiclePositionError
          refreshing={vehiclePositionFetching}
          onRetry={() => { void refetchVehiclePosition(); }}
        />
      )}


      {!loading && !hasDataError && (!driver || ((activeTrips.length === 0 && !autoTrip) && standaloneLoads.length === 0)) && (
        <NoLoadsHelp
          driverLinked={!!driver}
          driverActive={driver?.active ?? false}
          hasAssignedLoads={standaloneLoads.length > 0 || myLoads.length > 0}
          hasActiveTrip={activeTrips.length > 0 || !!autoTrip}
          driverName={driver?.name}
          driverId={driver?.id}
          onNavigateToLoads={() => navigate('/driver/loads')}
        />
      )}

      <DriverHomeTripLists
        standaloneLoads={standaloneLoads}
        trips={tripsToShow}
        driverName={driver?.name}
        isStartingTrip={isStartingTrip}
        onAccessTrip={(trip) => accessTrip(trip.id, trip.status, trip.actual_start_at, trip.loads?.status, trip.tenant_id)}
      />


      {/* Delivery map com dados reais — só quando há paradas geolocalizadas na viagem. */}
      {showRealMap ? <DriverHomeDeliveryMap stops={realMapStops} vehicle={realVehicle} /> : null}

      {/* Checklist status banner */}
      {autoTrip && !checklist.isLoading && (!checklist.preCompleted || !checklist.postCompleted) && (
        <DriverHomeChecklistAlert
          preCompleted={checklist.preCompleted}
          preCheckedCount={checklist.preCheckedCount}
          preTotalCount={checklist.preTotalCount}
          postCheckedCount={checklist.postCheckedCount}
          postTotalCount={checklist.postTotalCount}
          onOpen={() => navigate('/driver/checklist')}
        />
      )}

      {/* Quick actions */}
      <DriverHomeQuickActions onNavigate={navigate} />
    </div>
  );
}
