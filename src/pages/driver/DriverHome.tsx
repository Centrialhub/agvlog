import { useQuery, useQueryClient as useTanstackQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { useDriverHomeVehiclePosition } from '@/hooks/useDriverHomeVehiclePosition';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, MapPin, Package, ArrowRight, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import NoLoadsHelp from '@/components/driver/NoLoadsHelp';
import { useEffect, useState } from 'react';
import { type DeliveryPoint } from '@/components/driver/DriverDeliveryMap';
import DriverLoadNotes from '@/components/driver/DriverLoadNotes';
import { DriverHomeDeliveryMap, DriverHomeQuickActions } from '@/components/driver/DriverHomePanels';
import { TRIP_ACTIVE_STATUSES, tripStatusLabel, LOAD_ACTIVE_STATUSES } from '@/lib/status';
import { LOAD_STATUS_LABELS, TERMINAL_LOAD_STATUSES } from '@/lib/status/loadStatus';
import { useDriverTripActions } from '@/hooks/useDriverTripActions';
import { DRIVER_TRIP_SELECT, driverTripNeedsReconciliation, isDriverTripStarted, normalizeDriverTrip, resolveCanonicalTripLink, type DriverTrip } from '@/lib/driverTrip';
import { NextDestinationCard } from '@/components/driver/NextDestinationCard';
import { getNextDriverStop, getPendingDriverStops, readDriverRouteSnapshot, saveDriverRouteSnapshot } from '@/lib/driver/offlineRouteSnapshot';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';
import {useDriverPhysicalJourney} from '@/hooks/useDriverPhysicalJourney';




export default function DriverHome() {
  const { data: tenantDriver, isLoading: driverLoading } = useCurrentDriver();
  const {data:physicalJourney,isLoading:physicalJourneyLoading}=useDriverPhysicalJourney();
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
    queryKey: ['driver_my_trips', driver?.id, autoTrip?.id, physicalJourney?.journey?.id, multiTenantJourney],
    queryFn: async () => {
      if (!driver) return [];
      if (multiTenantJourney) return physicalJourney!.trips as unknown as DriverTrip[];
      
      // If we already have an autoTrip from the hook, use it as the primary
      if (autoTrip) {
        return [autoTrip];
      }

      const { data, error } = await supabase
        .from('dispatch_trips')
        .select(DRIVER_TRIP_SELECT)
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
    enabled: !!driver && !physicalJourneyLoading,
  });

  const {
    data: myLoads = [],
    isLoading: loadsLoading,
    isError: loadsFailed,
    error: loadsError,
    refetch: refetchLoads,
  } = useQuery({
    queryKey: ['driver_my_loads', driver?.id, physicalJourney?.journey?.id, multiTenantJourney],
    queryFn: async () => {
      if (!driver) return [];
      if (multiTenantJourney) return [];
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
        .eq('driver_id', driver.id)
        .not('status', 'in', `(${TERMINAL_LOAD_STATUSES.join(',')})`)
        .order('created_at', { ascending: false })
        .limit(20);
      if (error) throw error;
      return data || [];
    },
    enabled: !!driver && !physicalJourneyLoading,
  });

  // Paradas + posição do veículo para o mapa quando houver viagem real.
  const primaryTrip = activeTrips[0];
  const homeStopsQuery = useQuery({
    queryKey: ['driver_home_stops', primaryTrip?.id, physicalJourney?.journey?.id, multiTenantJourney],
    queryFn: async () => {
      if (!primaryTrip?.id) return [];
      if(multiTenantJourney)return physicalJourney!.stops.filter(stop=>stop.dispatch_trip_id===primaryTrip.id);
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('id, stop_order, destination, status, latitude, longitude, notes, client_id, actual_arrival_at, actual_departure_at, clients(company_name)')
        .eq('dispatch_trip_id', primaryTrip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!primaryTrip?.id,
  });
  const { data: realStops = [] } = homeStopsQuery;

  const {
    data: vehiclePos,
    isError: vehiclePositionFailed,
    isFetching: vehiclePositionFetching,
    refetch: refetchVehiclePosition,
  } = useDriverHomeVehiclePosition(primaryTrip?.vehicle_id);

  // Realtime: refresh assigned loads/trips whenever the driver assignment or status changes.
  useEffect(() => {
    if (!driver?.id) return undefined;
    const channel = supabase
      .channel(`driver_home_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'loads', filter: `driver_id=eq.${driver.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['driver_my_loads', driver.id] });
          queryClient.invalidateQueries({ queryKey: ['driver_my_trips', driver.id] });
        },
      )
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_trips', filter: `driver_id=eq.${driver.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['driver_my_trips', driver.id] });
          queryClient.invalidateQueries({ queryKey: ['driver_my_loads', driver.id] });
        },
      )
      .subscribe((status) => {
        if (status === 'SUBSCRIBED') {
          queryClient.invalidateQueries({ queryKey: ['driver_my_loads', driver.id] });
          queryClient.invalidateQueries({ queryKey: ['driver_my_trips', driver.id] });
        }
      });
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, queryClient]);

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

  const loading = driverLoading || physicalJourneyLoading || autoTripLoading || tripsLoading || loadsLoading;
  const dataError = autoTripError ?? tripsError ?? loadsError;
  const hasDataError = autoTripFailed || tripsFailed || loadsFailed;
  const dataErrorMessage = dataError instanceof Error
    ? dataError.message
    : 'Não foi possível carregar a viagem e as cargas do motorista.';
  
  // Inclui também viagens onde a carga associada está em estados operacionais
  const tripsToShow = activeTrips.filter((activeTrip) =>
    (TRIP_ACTIVE_STATUSES as readonly string[]).includes(activeTrip.status) ||
    (activeTrip.loads?.status && (LOAD_ACTIVE_STATUSES as readonly string[]).includes(activeTrip.loads.status))
  );

  // Constrói pontos reais do mapa a partir das paradas com lat/lng.
  const TERMINAL_STOP_STATUSES = new Set(['completed', 'delivered', 'refused', 'returned', 'failed', 'partial_delivery']);
  const realMapStops: DeliveryPoint[] = realStops
    .filter((stop) => stop.latitude != null && stop.longitude != null)
    .map((stop, index) => ({
      id: stop.id,
      name: stop.clients?.company_name || stop.destination || `Parada ${index + 1}`,
      lat: Number(stop.latitude),
      lng: Number(stop.longitude),
      status: TERMINAL_STOP_STATUSES.has(stop.status)
        ? 'done'
        : stop.status === 'arrived'
          ? 'current'
          : 'pending',
      sequence: stop.stop_order ?? index,
    }));
  const realVehicle =
    vehiclePos && vehiclePos.lat != null && vehiclePos.lng != null
      ? { lat: Number(vehiclePos.lat), lng: Number(vehiclePos.lng), plate: primaryTrip?.vehicles?.plate || '' }
      : null;
  const showRealMap = realMapStops.length > 0;
  const routeTenantId=primaryTrip?.tenant_id??currentTenant?.id;
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
        <Card className="border-destructive/50">
          <CardContent className="p-4 space-y-3">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Falha ao carregar a operação</p>
                <p className="text-xs text-muted-foreground">{dataErrorMessage}</p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => {
                void refetchAutoTrip();
                void refetchTrips();
                void refetchLoads();
              }}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      )}

      {!loading && primaryTrip?.vehicle_id && vehiclePositionFailed && (
        <Card className="border-destructive/50">
          <CardContent className="p-4 space-y-3" role="alert">
            <div className="flex items-start gap-2">
              <AlertTriangle className="h-4 w-4 text-destructive mt-0.5 shrink-0" />
              <div>
                <p className="text-sm font-medium">Posição do veículo indisponível</p>
                <p className="text-xs text-muted-foreground">
                  Não foi possível atualizar a localização. As paradas e demais dados da viagem continuam disponíveis.
                </p>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={vehiclePositionFetching}
              onClick={() => { void refetchVehiclePosition(); }}
            >
              {vehiclePositionFetching ? 'Atualizando posição…' : 'Tentar atualizar posição'}
            </Button>
          </CardContent>
        </Card>
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

      {standaloneLoads.length > 0 && (
        <div className="space-y-2">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Cargas atribuídas ({standaloneLoads.length})
          </p>
          {standaloneLoads.map((load) => (
            <Card key={load.id} className="border-l-4 border-l-warning">
              <CardContent className="p-4 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-warning" />
                    <span className="text-sm font-medium">Carga {load.load_number}</span>
                  </div>
                  <Badge variant="outline" className="text-[10px]">
                    {LOAD_STATUS_LABELS[load.status as keyof typeof LOAD_STATUS_LABELS] || load.status}
                  </Badge>
                </div>
                <div className="space-y-1 text-xs text-muted-foreground">
                  {(load.origin || load.destination) && (
                    <div className="flex items-center gap-1.5">
                      <MapPin className="h-3 w-3" />
                      <span>{load.origin || '—'}</span>
                      <ArrowRight className="h-3 w-3" />
                      <span>{load.destination || '—'}</span>
                    </div>
                  )}
                  <div className="flex items-center gap-3">
                    {load.vehicles?.plate && (
                      <span className="flex items-center gap-1"><Truck className="h-3 w-3" />{load.vehicles.plate}</span>
                    )}
                    {(load.total_pallet_count ?? 0) > 0 && (
                      <span>{load.total_pallet_count} pallets</span>
                    )}
                    {(load.total_weight_kg ?? 0) > 0 && (
                      <span>{Number(load.total_weight_kg).toLocaleString('pt-BR')} kg</span>
                    )}
                  </div>
                </div>
                <p className="text-[10px] text-muted-foreground italic">
                  Aguardando liberação da viagem pela equipe de operação.
                </p>
                <DriverLoadNotes
                  loadId={load.id}
                  loadNumber={load.load_number}
                  vehiclePlate={load.vehicles?.plate}
                  driverName={driver?.name}
                />
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {tripsToShow.length > 0 && (
        <div className="space-y-3">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
            Viagens ativas ({tripsToShow.length})
          </p>
          {tripsToShow.map((trip) => (
            <Card key={trip.id} className="border-l-4 border-l-primary">
              <CardContent className="p-4 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Package className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium">
                      Carga {trip.loads?.load_number || '—'}
                    </span>
                  </div>
                  <Badge variant="secondary" className="text-[10px]">
                    {tripStatusLabel(trip.status)}
                  </Badge>
                </div>

                <div className="space-y-1.5 text-xs text-muted-foreground">
                  <div className="flex items-center gap-1.5">
                    <MapPin className="h-3 w-3" />
                    <span>{trip.loads?.origin || '—'}</span>
                    <ArrowRight className="h-3 w-3" />
                    <span>{trip.loads?.destination || '—'}</span>
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Truck className="h-3 w-3" />
                    <span>{trip.vehicles?.plate || 'Sem veículo'}</span>
                  </div>
                </div>

                <Button
                  size="sm"
                  className="w-full"
                  disabled={isStartingTrip || driverTripNeedsReconciliation(trip.status, trip.actual_start_at, trip.loads?.status)}
                  onClick={() => accessTrip(trip.id, trip.status, trip.actual_start_at, trip.loads?.status, trip.tenant_id)}
                >
                  {driverTripNeedsReconciliation(trip.status, trip.actual_start_at, trip.loads?.status)
                    ? 'Revisão operacional necessária'
                    : isDriverTripStarted(trip.status, trip.actual_start_at)
                    ? 'Acessar Viagem'
                    : 'Iniciar Viagem'}
                </Button>
                {trip.loads?.id && (
                  <DriverLoadNotes
                    loadId={trip.loads.id}
                    loadNumber={trip.loads.load_number}
                    vehiclePlate={trip.vehicles?.plate}
                    driverName={driver?.name}
                  />
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}


      {/* Delivery map com dados reais — só quando há paradas geolocalizadas na viagem. */}
      {showRealMap ? <DriverHomeDeliveryMap stops={realMapStops} vehicle={realVehicle} /> : null}

      {/* Checklist status banner */}
      {autoTrip && !checklist.isLoading && (!checklist.preCompleted || !checklist.postCompleted) && (
        <Card
          className="border-warning/50 bg-warning/5 cursor-pointer hover:bg-warning/10 transition-colors"
          role="button"
          tabIndex={0}
          onClick={() => navigate('/driver/checklist')}
          onKeyDown={(event) => {
            if (event.key === 'Enter' || event.key === ' ') {
              event.preventDefault();
              navigate('/driver/checklist');
            }
          }}
        >
          <CardContent className="p-3 flex items-center gap-3">
            <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
            <div className="flex-1">
              <p className="text-xs font-medium">Checklist pendente</p>
              <p className="text-[10px] text-muted-foreground">
                {!checklist.preCompleted
                  ? `Pré-viagem: ${checklist.preCheckedCount}/${checklist.preTotalCount} itens`
                  : `Pós-viagem: ${checklist.postCheckedCount}/${checklist.postTotalCount} itens`}
              </p>
            </div>
            <ClipboardCheck className="h-4 w-4 text-muted-foreground" />
          </CardContent>
        </Card>
      )}

      {/* Quick actions */}
      <DriverHomeQuickActions onNavigate={navigate} />
    </div>
  );
}
