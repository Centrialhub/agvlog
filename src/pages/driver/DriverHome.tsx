import { useQuery, useQueryClient as useTanstackQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, MapPin, Package, Clock, ArrowRight, ClipboardCheck, AlertTriangle, Receipt, FileText, Map } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import NoLoadsHelp from '@/components/driver/NoLoadsHelp';
import { useEffect } from 'react';
import DriverDeliveryMap, { DeliveryPoint } from '@/components/driver/DriverDeliveryMap';
import DriverLoadNotes from '@/components/driver/DriverLoadNotes';
import { TRIP_ACTIVE_STATUSES, tripStatusLabel, LOAD_ACTIVE_STATUSES } from '@/lib/status';
import { LOAD_STATUS_LABELS, TERMINAL_LOAD_STATUSES } from '@/lib/status/loadStatus';
import { useDriverTripActions } from '@/hooks/useDriverTripActions';
import { DRIVER_TRIP_SELECT, driverTripNeedsReconciliation, isDriverTripStarted, normalizeDriverTrip, resolveCanonicalTripLink } from '@/lib/driverTrip';




export default function DriverHome() {
  const { data: driver, isLoading: driverLoading } = useCurrentDriver();
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
    queryKey: ['driver_my_trips', driver?.id, autoTrip?.id],
    queryFn: async () => {
      if (!driver) return [];
      
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
    enabled: !!driver,
  });

  const {
    data: myLoads = [],
    isLoading: loadsLoading,
    isError: loadsFailed,
    error: loadsError,
    refetch: refetchLoads,
  } = useQuery({
    queryKey: ['driver_my_loads', driver?.id],
    queryFn: async () => {
      if (!driver) return [];
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
    enabled: !!driver,
  });

  // Paradas + posição do veículo para o mapa quando houver viagem real.
  const primaryTrip = activeTrips[0];
  const { data: realStops = [] } = useQuery({
    queryKey: ['driver_home_stops', primaryTrip?.id],
    queryFn: async () => {
      if (!primaryTrip?.id) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('id, stop_order, destination, status, latitude, longitude, clients(company_name)')
        .eq('dispatch_trip_id', primaryTrip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!primaryTrip?.id,
  });

  const { data: vehiclePos } = useQuery({
    queryKey: ['driver_home_vehicle_pos', primaryTrip?.vehicle_id],
    queryFn: async () => {
      if (!primaryTrip?.vehicle_id) return null;
      const { data } = await supabase
        .from('positions_last')
        .select('lat, lng')
        .eq('vehicle_id', primaryTrip.vehicle_id)
        .maybeSingle();
      return data;
    },
    enabled: !!primaryTrip?.vehicle_id,
  });

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

  const loading = driverLoading || autoTripLoading || tripsLoading || loadsLoading;
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

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Olá, {driver?.name || 'Motorista'}</h1>
        <p className="text-sm text-muted-foreground">Comunicação com a Operação</p>
      </div>

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
                  onClick={() => accessTrip(trip.id, trip.status, trip.actual_start_at, trip.loads?.status)}
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
      {showRealMap && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Map className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Mapa das entregas</span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {realMapStops.filter((s) => s.status === 'done').length}/{realMapStops.length} entregues
              </Badge>
            </div>
            <DriverDeliveryMap stops={realMapStops} vehicle={realVehicle} height={240} />
            <div className="flex items-center justify-around text-[10px] text-muted-foreground pt-1">
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-success" /> Entregue
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-primary" /> Atual
              </span>
              <span className="flex items-center gap-1">
                <span className="h-2.5 w-2.5 rounded-full bg-muted-foreground" /> Pendente
              </span>
            </div>
          </CardContent>
        </Card>
      )}

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
      <div className="grid grid-cols-2 gap-3">
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" role="button" tabIndex={0} onClick={() => navigate('/driver/journey')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/driver/journey'); } }}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Jornada</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" role="button" tabIndex={0} onClick={() => navigate('/driver/expenses')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/driver/expenses'); } }}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Despesas</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" role="button" tabIndex={0} onClick={() => navigate('/driver/checklist')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/driver/checklist'); } }}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Checklist</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" role="button" tabIndex={0} onClick={() => navigate('/driver/events')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/driver/events'); } }}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Eventos</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors col-span-2" role="button" tabIndex={0} onClick={() => navigate('/driver/issues')} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); navigate('/driver/issues'); } }}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Ocorrências</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
