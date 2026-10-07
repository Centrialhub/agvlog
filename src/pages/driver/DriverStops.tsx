import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useOnlineStatus } from '@/hooks/useOnlineStatus';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, CheckCircle, Clock, ArrowRight, AlertTriangle } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { NextDestinationCard } from '@/components/driver/NextDestinationCard';
import { NavigationLauncher } from '@/components/driver/NavigationLauncher';

import { isStopTerminal, STOP_STATUS_LABELS } from '@/lib/status';
import { DRIVER_TRIP_SELECT, isDriverTripStarted, normalizeDriverTrip } from '@/lib/driverTrip';
import { getCurrentDriverLocation } from '@/lib/driverLocation';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';
import { deliveryErrorMessage, invalidateDeliveryQueries } from '@/lib/driver/driverDeliverySubmission';
import {
  getNextDriverStop,
  getPendingDriverStops,
} from '@/lib/driver/offlineRouteSnapshot';
import { useDriverStopsSnapshots } from '@/hooks/useDriverStopsSnapshots';


const STATUS_LABELS: Record<string, string> = STOP_STATUS_LABELS;

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  arrived: 'bg-primary/10 text-primary',
  completed: 'bg-green-100 text-green-700',
  skipped: 'bg-destructive/10 text-destructive',
  refused: 'bg-destructive/10 text-destructive',
  returned: 'bg-destructive/10 text-destructive',
  partial_delivery: 'bg-amber-100 text-amber-700',
  failed: 'bg-destructive/10 text-destructive',
  delivered: 'bg-green-100 text-green-700',
};

function isRouteAccessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const value = error as { code?: string; status?: number };
  return ['401', '403', '42501', 'PGRST301', 'PGRST302', 'PGRST116'].includes(value.code ?? '')
    || value.status === 401 || value.status === 403;
}

export default function DriverStops() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const isOnline = useOnlineStatus();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const offlineCommands = useDriverOperationalOffline();
  const [searchParams] = useSearchParams();
  const tripIdParam = searchParams.get('trip');
  const driverQuery = useCurrentDriver();
  const driver = driverQuery.data;
  const autoTripQuery = useActiveTrip(driver?.id);
  const { data: autoTrip } = autoTripQuery;

  // If tripId is in URL use it, otherwise use auto-detected active trip
  const specificTripQuery = useQuery({
    queryKey: ['driver_trip_specific', currentTenant?.id, driver?.id, tripIdParam, user?.id],
    queryFn: async () => {
      if (!tripIdParam || !currentTenant || !driver) return null;
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select(DRIVER_TRIP_SELECT)
        .eq('id', tripIdParam)
        .eq('tenant_id', currentTenant.id)
        .eq('driver_id', driver.id)
        .maybeSingle();
      if (error) throw error;
      return data ? normalizeDriverTrip(data) : null;
    },
    enabled: !!tripIdParam && !!currentTenant && !!driver && !!user?.id,
  });
  const { data: trip } = specificTripQuery;

  const activeTrip = tripIdParam ? trip : autoTrip;

  const stopsQuery = useQuery({
    queryKey: ['driver_stops', currentTenant?.id, driver?.id, activeTrip?.id, user?.id],
    queryFn: async () => {
      if (!activeTrip || !currentTenant || !driver) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name)')
        .eq('dispatch_trip_id', activeTrip.id)
        .eq('tenant_id', currentTenant.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTrip?.id && !!currentTenant?.id && !!driver?.id && !!user?.id,
  });
  const { data: stops = [] } = stopsQuery;
  const tripResolutionQuery = tripIdParam ? specificTripQuery : autoTripQuery;
  const routeError = driverQuery.error ?? tripResolutionQuery.error ?? stopsQuery.error;
  const routeDenied = !currentTenant?.id || !user?.id
    || (driverQuery.isSuccess && !driver) || driver?.active === false
    || (!!driver?.tenant_id && driver.tenant_id !== currentTenant?.id)
    || (tripResolutionQuery.isSuccess && !activeTrip)
    || [driverQuery.error, tripResolutionQuery.error, stopsQuery.error].some(isRouteAccessDenied);
  const { cachedSnapshot, operationalSnapshot, snapshotPending, cachedScopeMatches } = useDriverStopsSnapshots({
    tenantId: currentTenant?.id, userId: user?.id, tripIdParam, activeTrip, driver, stops,
    stopsIsError: stopsQuery.isError, stopsIsPending: stopsQuery.isPending, routeError, routeDenied,
  });

  // Realtime: refresh stops when operator marks arrival/departure or updates status.
  useEffect(() => {
    if (!activeTrip?.id) return undefined;
    const channel = supabase
      .channel(`driver_stops_${activeTrip.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_stops', filter: `dispatch_trip_id=eq.${activeTrip.id}` },
        () => {
          void invalidateDeliveryQueries(qc);
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTrip?.id, qc]);

  const resolvedTripId = tripIdParam ?? activeTrip?.id;
  const cachedRouteMatches = !!cachedSnapshot && cachedScopeMatches && (!resolvedTripId || cachedSnapshot.trip.id === resolvedTripId);
  const operationalMatches = !!operationalSnapshot && operationalSnapshot.tenantId === currentTenant?.id
    && operationalSnapshot.actorId === user?.id && (!resolvedTripId || operationalSnapshot.tripId === resolvedTripId)
    && (!driver || operationalSnapshot.trip.driver.id === driver.id);
  const showingOfflineSnapshot = !isOnline && !routeDenied && (operationalMatches || cachedRouteMatches)
    && (!activeTrip || stopsQuery.isError || stopsQuery.isPending);
  const routeUnavailable = routeDenied || (isOnline && !!routeError);
  const storedTrip = operationalMatches ? {
    id: operationalSnapshot.trip.id, status: operationalSnapshot.trip.status,
    actual_start_at: operationalSnapshot.trip.actualStartAt, actual_end_at: operationalSnapshot.trip.actualEndAt,
    vehicle_id: operationalSnapshot.trip.vehicle?.id ?? null,
    vehicles: operationalSnapshot.trip.vehicle ? { plate: operationalSnapshot.trip.vehicle.plate, nickname: operationalSnapshot.trip.vehicle.nickname } : null,
    loads: operationalSnapshot.loads[0] ? { id: operationalSnapshot.loads[0].id, load_number: operationalSnapshot.loads[0].loadNumber,
      status: operationalSnapshot.loads[0].status, origin: operationalSnapshot.loads[0].origin, destination: operationalSnapshot.loads[0].destination } : null,
  } : null;
  const effectiveTrip = routeUnavailable ? null
    : activeTrip ?? (showingOfflineSnapshot ? storedTrip ?? (cachedRouteMatches ? cachedSnapshot?.trip : null) : null);
  const queuedForTrip = offlineCommands.commands.filter(command => command.aggregateId === effectiveTrip?.id
    && command.tenantId === currentTenant?.id && command.actorId === user?.id);
  const storedStops = operationalMatches ? operationalSnapshot.stops.map(stop => ({ id: stop.id, stop_order: stop.order,
    destination: stop.destination, status: stop.status, latitude: stop.latitude, longitude: stop.longitude, notes: stop.notes,
    actual_arrival_at: stop.actualArrivalAt, actual_departure_at: stop.actualDepartureAt,
    client_id: stop.client?.id ?? null, clients: stop.client ? { company_name: stop.client.name } : null })) : [];
  const effectiveStops = (routeUnavailable ? [] : showingOfflineSnapshot
    ? operationalMatches ? storedStops : cachedSnapshot?.stops ?? []
    : activeTrip ? stops : []).map(stop => {
    const queuedArrival = queuedForTrip.find(command => command.kind === 'arrival'
      && typeof command.payload === 'object' && command.payload !== null && !Array.isArray(command.payload)
      && command.payload.stop_id === stop.id);
    const queuedDeparture = queuedForTrip.find(command => command.kind === 'departure'
      && typeof command.payload === 'object' && command.payload !== null && !Array.isArray(command.payload)
      && command.payload.stop_id === stop.id);
    return {
      ...stop,
      status: queuedArrival && ['pending', 'planned', 'arriving'].includes(stop.status) ? 'arrived' : stop.status,
      actual_arrival_at: queuedArrival && !stop.actual_arrival_at ? queuedArrival.createdAt : stop.actual_arrival_at,
      actual_departure_at: queuedDeparture && !stop.actual_departure_at ? queuedDeparture.createdAt : stop.actual_departure_at,
      offline_pending: !!queuedArrival || !!queuedDeparture,
    };
  });

  const updateStop = useMutation({
    // The operational service persists offline before attempting its transport.
    networkMode: 'always',
    mutationFn: async ({ stopId, action }: { stopId: string; action: 'arrival' | 'depart' }) => {
      if (!effectiveTrip || !isDriverTripStarted(effectiveTrip.status,effectiveTrip.actual_start_at)) {
        throw new Error('Inicie a viagem antes de registrar chegada ou saída.');
      }
      const stop=effectiveStops.find(item=>item.id===stopId);
      if (!stop || isStopTerminal(stop.status)) throw new Error('Parada encerrada ou reatribuída. Atualize a viagem.');
      if (action === 'arrival') {
        const location = await getCurrentDriverLocation();
        return offlineCommands.submit({
          kind: 'arrival', aggregateId: effectiveTrip.id,
          payload: { trip_id: effectiveTrip.id, stop_id: stopId, latitude: location.latitude,
            longitude: location.longitude, accuracy_m: location.accuracyM },
        });
      }
      if (action === 'depart') {
        if (!stop.actual_arrival_at || !['arrived','servicing'].includes(stop.status)) throw new Error('Registre a chegada antes da saída.');
        return offlineCommands.submit({
          kind: 'departure', aggregateId: effectiveTrip.id,
          payload: { trip_id: effectiveTrip.id, stop_id: stopId, notes: null },
        });
      }
      throw new Error('Ação de parada inválida.');
    },
    onSuccess: async (result) => {
      if (!result) return;
      if (!result.queued) await invalidateDeliveryQueries(qc);
      toast({ title: result.queued ? 'Ação salva no aparelho' : 'Parada atualizada',
        description: result.queued ? 'Será sincronizada automaticamente quando houver conexão.' : undefined });
    },
    onError: (error: unknown) => toast({
      title: 'Erro',
      description: deliveryErrorMessage(error),
      variant: 'destructive',
    }),
  });

  const handleArrival = (stopId: string) => {
    updateStop.mutate({ stopId, action: 'arrival' });
  };

  const handleDeparture = (stopId: string) => {
    updateStop.mutate({ stopId, action: 'depart' });
  };

  const pendingStops = getPendingDriverStops(effectiveStops);
  const nextStop = getNextDriverStop(effectiveStops);
  const pageError = routeError;
  const pageErrorMessage = deliveryErrorMessage(pageError);
  const tripStarted = !!effectiveTrip && isDriverTripStarted(effectiveTrip.status,effectiveTrip.actual_start_at);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Paradas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {effectiveTrip?.loads?.load_number || '—'} · {effectiveStops.length} parada(s)
        </p>
        <p className="text-[11px] text-muted-foreground" role="status">
          A chegada exige GPS e validação de proximidade com a parada.
        </p>
        {effectiveTrip && !tripStarted && effectiveTrip.status!=='completed' && (
          <p role="alert" className="text-sm text-destructive">Inicie a viagem antes de registrar chegada ou saída.</p>
        )}
      </div>


      {((isOnline && (driverQuery.isLoading || tripResolutionQuery.isLoading || (activeTrip?.id && stopsQuery.isLoading)))
        || (!isOnline && snapshotPending && !routeDenied && (!activeTrip || stopsQuery.isPending))) && !showingOfflineSnapshot ? (
        <div className="space-y-3" aria-label="Carregando viagem">
          {[1, 2, 3].map((item) => (
            <div key={item} className="h-28 w-full animate-pulse rounded-xl bg-muted" />
          ))}
        </div>
      ) : pageError && !showingOfflineSnapshot ? (
        <Card className="border-destructive/50">
          <CardContent className="py-10 text-center space-y-4">
            <AlertTriangle className="h-10 w-10 text-destructive mx-auto opacity-80" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Falha ao carregar a viagem</p>
              <p className="text-xs text-muted-foreground">{pageErrorMessage}</p>
            </div>
            <Button
              variant="outline"
              size="sm"
              onClick={() => {
                void driverQuery.refetch();
                void tripResolutionQuery.refetch();
                if (activeTrip?.id) void stopsQuery.refetch();
              }}
            >
              Tentar novamente
            </Button>
          </CardContent>
        </Card>
      ) : !isOnline && !effectiveTrip?.id && !routeDenied ? (
        <Card><CardContent className="py-10 text-center" role="alert">
          Paradas indisponíveis offline para esta viagem e sessão. Conecte-se para carregar os dados.
        </CardContent></Card>
      ) : !effectiveTrip?.id ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <MapPin className="h-12 w-12 text-muted-foreground mx-auto opacity-20" />
            <div className="space-y-1">
              <p className="text-sm font-medium">{tripIdParam ? 'Viagem indisponível' : 'Nenhuma viagem ativa'}</p>
              <p className="text-xs text-muted-foreground">
                {tripIdParam ? 'Não foi possível acessar a viagem solicitada. Atualize para conferir seu vínculo.'
                  : 'Aguarde o despacho da carga pela operação para ver suas paradas.'}
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/driver/loads')}>
              Ver Minhas Cargas
            </Button>
          </CardContent>
        </Card>
      ) : effectiveStops.length === 0 ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <MapPin className="h-12 w-12 text-muted-foreground mx-auto opacity-20" />
            <p className="text-sm text-muted-foreground">Nenhuma parada programada para esta viagem.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {nextStop && (
            <NextDestinationCard
              stop={nextStop}
              remainingStops={pendingStops.length}
              offline={showingOfflineSnapshot}
            />
          )}
          <div className="flex items-center justify-between pt-1">
            <h2 className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Todas as paradas</h2>
            <span className="text-xs text-muted-foreground">{pendingStops.length} pendente(s)</span>
          </div>
          {effectiveStops.map((stop, idx) => (
            <Card key={stop.id} className={stop.status === 'arrived' ? 'border-primary' : ''}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {stop.clients?.company_name || stop.destination || `Parada ${idx + 1}`}
                      </p>
                      {stop.destination && stop.clients?.company_name && (
                        <p className="text-xs text-muted-foreground">{stop.destination}</p>
                      )}
                    </div>
                  </div>
                  <Badge className={`text-[10px] ${STATUS_COLORS[stop.status] || ''}`} variant="secondary">
                    {STATUS_LABELS[stop.status] || stop.status}
                  </Badge>
                </div>

                {stop.notes && (
                  <p className="text-xs text-muted-foreground bg-muted/50 rounded px-2 py-1">{stop.notes}</p>
                )}

                {stop.actual_arrival_at && (
                  <div className="flex items-center gap-1 text-xs text-muted-foreground">
                    <Clock className="h-3 w-3" />
                    Chegada: {new Date(stop.actual_arrival_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {stop.actual_departure_at && (
                      <> · Saída: {new Date(stop.actual_departure_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  {stop.destination && (
                    <NavigationLauncher
                      compact
                      className="min-w-44 flex-1"
                      destination={{
                        label: stop.clients?.company_name || stop.destination,
                        address: stop.destination,
                        latitude: stop.latitude,
                        longitude: stop.longitude,
                      }}
                    />
                  )}
                  {['pending','planned','arriving'].includes(stop.status) && (
                    <Button size="sm" className="text-xs" onClick={() => handleArrival(stop.id)} disabled={updateStop.isPending || !tripStarted}>
                      <ArrowRight className="h-3 w-3 mr-1" /> {updateStop.isPending ? 'Validando GPS…' : 'Cheguei'}
                    </Button>
                  )}
                  {['arrived','servicing'].includes(stop.status) && !stop.actual_departure_at && (
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => handleDeparture(stop.id)} disabled={updateStop.isPending || !tripStarted || !stop.actual_arrival_at}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Registrar saída
                    </Button>
                  )}
                  {stop.actual_departure_at && <Badge variant="outline" className="text-[10px]">Saída registrada</Badge>}
                  {stop.offline_pending && <Badge variant="outline" className="text-[10px]">Sincronização pendente</Badge>}
                  {isStopTerminal(stop.status) && (
                    <Badge variant="secondary" className="text-[10px]">Encerrada</Badge>
                  )}
                </div>
                {!isStopTerminal(stop.status) && stop.actual_arrival_at && (
                  <div className="space-y-2">
                    <p className="text-xs text-muted-foreground">Registrar saída não conclui a entrega. Informe o resultado e os comprovantes em Entregas.</p>
                    <Button variant="outline" size="sm" onClick={()=>navigate(`/driver/deliveries?trip=${effectiveTrip.id}`)}>Registrar resultado da entrega</Button>
                  </div>
                )}
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
