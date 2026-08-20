import { useQuery, useQueryClient as useTanstackQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver } from '@/hooks/useCurrentDriver';
import { useDriverWorkspace, useDriverExecution } from '@/hooks/useDriverWorkspace';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, MapPin, Package, Clock, ArrowRight, ClipboardCheck, AlertTriangle, Receipt, FileText, Map } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

import NoLoadsHelp from '@/components/driver/NoLoadsHelp';
import { useState, useEffect } from 'react';
import DriverDeliveryMap, { DeliveryPoint } from '@/components/driver/DriverDeliveryMap';
import DriverLoadNotes from '@/components/driver/DriverLoadNotes';
import { TRIP_ACTIVE_STATUSES, tripStatusLabel, LOAD_ACTIVE_STATUSES } from '@/lib/status';
import { LOAD_STATUS_LABELS, TERMINAL_LOAD_STATUSES } from '@/lib/status/loadStatus';




export default function DriverHome() {
  const { currentTenant } = useTenant();
  const { data: driver, isLoading: driverLoading } = useCurrentDriver();
  const navigate = useNavigate();
  const queryClient = useTanstackQueryClient();
  const { data: workspace, isLoading: workspaceLoading } = useDriverWorkspace();
  const { reportEvent } = useDriverExecution();
  
  const trip = workspace?.trip;
  const checklist = useChecklistStatus(trip?.id);

  const activeTrips = workspace?.has_active_trip ? [workspace.trip] : [];
  const tripsLoading = workspaceLoading;
  const loadsLoading = workspaceLoading;
  const standaloneLoads = workspace?.has_active_trip ? [] : (workspace?.loads || []);

  // Paradas + posição do veículo para o mapa quando houver viagem real.
  const primaryTrip: any = activeTrips[0];
  const realStops = workspace?.stops || [];

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

  // Realtime subscription moved to useDriverWorkspace for simplified UI logic
  // but keeping a manual invalidation trigger for UI consistency if needed
  useEffect(() => {
    if (!driver?.id) return;
    const channel = supabase
      .channel(`driver_workspace_events_${driver.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_events', filter: `tenant_id=eq.${currentTenant?.id}` },
        () => {
          queryClient.invalidateQueries({ queryKey: ['driver_workspace'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [driver?.id, currentTenant?.id, queryClient]);

  const loading = driverLoading || workspaceLoading;

  const loading = driverLoading || tripsLoading || loadsLoading;
  
  const tripsToShow = activeTrips;

  // Constrói pontos reais do mapa a partir das paradas com lat/lng.
  const TERMINAL_STOP_STATUSES = new Set(['completed', 'delivered', 'refused', 'returned', 'failed', 'partial_delivery']);
  const realMapStops: DeliveryPoint[] = (realStops as any[])
    .filter((s) => s.latitude != null && s.longitude != null)
    .map((s, idx) => ({
      id: s.id,
      name: s.clients?.company_name || s.destination || `Parada ${idx + 1}`,
      lat: Number(s.latitude),
      lng: Number(s.longitude),
      status: TERMINAL_STOP_STATUSES.has(s.status)
        ? 'done'
        : s.status === 'arrived'
          ? 'current'
          : 'pending',
      sequence: s.stop_order ?? idx,
    }));
  const realVehicle =
    vehiclePos && vehiclePos.lat != null && vehiclePos.lng != null
      ? { lat: Number(vehiclePos.lat), lng: Number(vehiclePos.lng), plate: primaryTrip?.vehicles?.plate || '' }
      : undefined;
  const showRealMap = realMapStops.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Olá, {driver?.name || 'Motorista'}</h1>
        <p className="text-sm text-muted-foreground">Comunicação com a Operação</p>
      </div>


      {!loading && (!driver || (!workspace?.has_active_trip && standaloneLoads.length === 0)) && (
        <NoLoadsHelp
          driverLinked={!!driver}
          driverActive={!!driver && (driver as any).status !== 'inactive'}
          hasAssignedLoads={standaloneLoads.length > 0 || myLoads.length > 0}
          hasActiveTrip={workspace?.has_active_trip || false}
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
          {standaloneLoads.map((load: any) => (
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
                    {load.total_pallet_count > 0 && (
                      <span>{load.total_pallet_count} pallets</span>
                    )}
                    {load.total_weight_kg > 0 && (
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
          {tripsToShow.map((trip: any) => (
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
                  onClick={async () => {
                    if (trip.status === 'planned') {
                      reportEvent.mutate({
                        tripId: trip.id,
                        eventType: 'trip_start',
                        payload: { odometer: 0 }, // Should ideally prompt for this
                        idempotencyKey: `trip-start-${trip.id}`
                      });
                    }
                    
                    navigate(`/driver/stops?trip=${trip.id}`);
                  }}
                >
                  Acessar Viagem
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
      {trip && !checklist.isLoading && (!checklist.preCompleted || !checklist.postCompleted) && (
        <Card
          className="border-warning/50 bg-warning/5 cursor-pointer hover:bg-warning/10 transition-colors"
          onClick={() => navigate('/driver/checklist')}
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
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/journey')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Clock className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Jornada</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/expenses')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <Receipt className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Despesas</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/checklist')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <ClipboardCheck className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Checklist</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors" onClick={() => navigate('/driver/events')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <FileText className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Eventos</span>
          </CardContent>
        </Card>
        <Card className="cursor-pointer hover:bg-accent/50 transition-colors col-span-2" onClick={() => navigate('/driver/issues')}>
          <CardContent className="p-3 flex flex-col items-center gap-1.5">
            <AlertTriangle className="h-5 w-5 text-muted-foreground" />
            <span className="text-xs font-medium">Ocorrências</span>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
