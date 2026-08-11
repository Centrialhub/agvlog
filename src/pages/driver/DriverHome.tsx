import { useQuery, useQueryClient as useTanstackQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { Card, CardContent } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Truck, MapPin, Package, Clock, ArrowRight, ClipboardCheck, AlertTriangle, Receipt, FileText, Map } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import DemoBanner from '@/components/driver/DemoBanner';
import { useQueryClient } from '@tanstack/react-query';
import NoLoadsHelp from '@/components/driver/NoLoadsHelp';
import { useState, useEffect } from 'react';
import DriverDeliveryMap, { DeliveryPoint } from '@/components/driver/DriverDeliveryMap';
import DriverLoadNotes from '@/components/driver/DriverLoadNotes';
import { TRIP_ACTIVE_STATUSES, tripStatusLabel } from '@/lib/status';
import { LOAD_STATUS_LABELS, TERMINAL_LOAD_STATUSES } from '@/lib/status/loadStatus';

const IS_PROD = import.meta.env.PROD;

const DEMO_TRIP = {
  id: 'demo-trip',
  status: 'in_progress',
  loads: { load_number: '1042 (DEMO)', origin: 'CD Montes Claros/MG', destination: 'PAI PEDRO - PIRAPORA - JAÍBA' },
  vehicles: { plate: 'DEM-1234', nickname: 'Demo' },
};

const DEMO_MAP_STOPS: DeliveryPoint[] = [
  { id: 's1', name: 'CD Montes Claros', lat: -16.7286, lng: -43.8582, status: 'done', sequence: 0 },
  { id: 's2', name: 'AMANDA D - Pai Pedro', lat: -15.4889, lng: -42.6692, status: 'done', sequence: 1 },
  { id: 's3', name: 'LINDSAY @ - Pirapora', lat: -17.3447, lng: -44.9425, status: 'current', sequence: 2 },
  { id: 's4', name: 'IRMÃOS FERREIRA - Jaíba', lat: -15.3225, lng: -43.6694, status: 'pending', sequence: 3 },
  { id: 's5', name: 'CG BEATRIZ - Pirapora', lat: -17.3500, lng: -44.9400, status: 'pending', sequence: 4 },
];

const DEMO_VEHICLE_POS = { lat: -17.3447, lng: -44.9425, plate: 'DEM-1234' };

export default function DriverHome() {
  const { currentTenant } = useTenant();
  const { data: driver, isLoading: driverLoading } = useCurrentDriver();
  const navigate = useNavigate();
  const queryClient = useTanstackQueryClient();
  const { data: autoTrip } = useActiveTrip(driver?.id);
  const checklist = useChecklistStatus(autoTrip?.id);
  const [demoActive, setDemoActive] = useState(true);

  const { data: activeTrips = [], isLoading: tripsLoading } = useQuery({
    queryKey: ['driver_my_trips', driver?.id],
    queryFn: async () => {
      if (!driver) return [];
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(id, load_number, origin, destination, status), vehicles(plate, nickname)')
        .eq('driver_id', driver.id)
        .in('status', TRIP_ACTIVE_STATUSES as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(5);
      if (error) throw error;
      return data || [];
    },
    enabled: !!driver,
  });

  const { data: myLoads = [], isLoading: loadsLoading } = useQuery({
    queryKey: ['driver_my_loads', driver?.id],
    queryFn: async () => {
      if (!driver) return [];
      const { data, error } = await supabase
        .from('loads')
        .select('id, load_number, origin, destination, status, trip_id, total_pallet_count, total_weight_kg, scheduled_load_at, vehicles(plate, nickname)')
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
  const primaryTrip: any = activeTrips[0];
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
    if (!driver?.id) return;
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
        console.log(`[DriverHome] Realtime subscription for driver ${driver.id}: ${status}`);
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
  const tripLoadIds = new Set(activeTrips.map((t: any) => t.loads?.id || t.load_id).filter(Boolean));
  const standaloneLoads = myLoads.filter((l: any) => !l.trip_id && !tripLoadIds.has(l.id));

  const loading = driverLoading || tripsLoading || loadsLoading;

  // Em produção nunca mostra dados demo; só aparece se realmente não há viagem real.
  const isDemo =
    !IS_PROD &&
    (!driver || (activeTrips.length === 0 && standaloneLoads.length === 0)) &&
    demoActive &&
    !loading;
  const tripsToShow: any[] = isDemo ? [DEMO_TRIP] : activeTrips;

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
  const showRealMap = !isDemo && realMapStops.length > 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Olá, {driver?.name || 'Motorista'}</h1>
        <p className="text-sm text-muted-foreground">Seu painel de viagem</p>
      </div>

      {isDemo && (
        <DemoBanner
          message="Sem viagem real — mostrando uma viagem fictícia."
          onReset={() => setDemoActive(false)}
        />
      )}

      {!loading && !isDemo && (!driver || (activeTrips.length === 0 && standaloneLoads.length === 0)) && (
        <NoLoadsHelp
          driverLinked={!!driver}
          driverActive={!!driver && (driver as any).status !== 'inactive'}
          hasAssignedLoads={standaloneLoads.length > 0 || myLoads.length > 0}
          hasActiveTrip={activeTrips.length > 0}
          driverName={driver?.name}
          driverId={driver?.id}
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
                  Aguardando criação da viagem pela operação para liberar paradas.
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
                  onClick={() => navigate(`/driver/stops?trip=${trip.id}`)}
                >
                  Ver Paradas
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

      {/* Delivery map dashboard — somente em modo demo (placeholder visual). */}
      {isDemo && tripsToShow.length > 0 && (
        <Card>
          <CardContent className="p-3 space-y-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Map className="h-4 w-4 text-primary" />
                <span className="text-sm font-medium">Mapa das entregas</span>
              </div>
              <Badge variant="outline" className="text-[10px]">
                {DEMO_MAP_STOPS.filter((s) => s.status === 'done').length}/{DEMO_MAP_STOPS.length} entregues
              </Badge>
            </div>
            <DriverDeliveryMap stops={DEMO_MAP_STOPS} vehicle={DEMO_VEHICLE_POS} height={240} />
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
