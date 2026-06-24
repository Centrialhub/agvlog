import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, CheckCircle, Clock, ArrowRight } from 'lucide-react';
import { useState } from 'react';
import DemoBanner from '@/components/driver/DemoBanner';
import { canUseDriverDemo } from '@/lib/driver/demoMode';

const DEMO_TRIP = { id: 'demo-trip', loads: { load_number: '1042 (DEMO)' } };
const DEMO_STOPS_INITIAL: any[] = [
  { id: 'd1', stop_order: 1, status: 'arrived',  destination: 'Av. Brasil, 1200 - Pirapora/MG', notes: 'Pedido 2100077', clients: { company_name: 'AMANDA D' }, actual_arrival_at: new Date(Date.now() - 30*60000).toISOString() },
  { id: 'd2', stop_order: 2, status: 'pending',  destination: 'Rua das Flores, 45 - Jaíba/MG',   notes: 'NF 2100098',     clients: { company_name: 'LINDSAY @' } },
  { id: 'd3', stop_order: 3, status: 'pending',  destination: 'BR-365 km 12 - Pai Pedro/MG',     notes: 'Pedido 2100090', clients: { company_name: 'IRMÃOS FERREIRA' } },
  { id: 'd4', stop_order: 4, status: 'completed',destination: 'Centro - Espinosa/MG',            notes: 'NF 2100050',     clients: { company_name: 'MERCADO BOM PRECO' }, actual_arrival_at: new Date(Date.now() - 4*3600000).toISOString(), actual_departure_at: new Date(Date.now() - 3*3600000).toISOString() },
];

const STATUS_LABELS: Record<string, string> = {
  pending: 'Pendente',
  arrived: 'No local',
  completed: 'Concluída',
  skipped: 'Pulada',
};

const STATUS_COLORS: Record<string, string> = {
  pending: 'bg-muted text-muted-foreground',
  arrived: 'bg-primary/10 text-primary',
  completed: 'bg-green-100 text-green-700',
  skipped: 'bg-destructive/10 text-destructive',
};

export default function DriverStops() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const [searchParams] = useSearchParams();
  const tripIdParam = searchParams.get('trip');
  const { data: driver } = useCurrentDriver();
  const { data: autoTrip } = useActiveTrip(driver?.id);

  // If tripId is in URL use it, otherwise use auto-detected active trip
  const { data: trip } = useQuery({
    queryKey: ['driver_trip_specific', tripIdParam],
    queryFn: async () => {
      if (!tripIdParam || !currentTenant) return null;
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(load_number, origin, destination)')
        .eq('id', tripIdParam)
        .eq('tenant_id', currentTenant.id)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!tripIdParam && !!currentTenant,
  });

  const activeTrip = tripIdParam ? trip : autoTrip;
  const [demoStops, setDemoStops] = useState<any[]>(DEMO_STOPS_INITIAL);

  const { data: stops = [] } = useQuery({
    queryKey: ['driver_stops', activeTrip?.id],
    queryFn: async () => {
      if (!activeTrip) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name)')
        .eq('dispatch_trip_id', activeTrip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!activeTrip?.id,
  });

  const updateStop = useMutation({
    mutationFn: async ({ stopId, action, reason }: { stopId: string; action: 'arrival' | 'depart' | 'skipped' | 'refused' | 'damaged' | 'returned' | 'partial_delivery'; reason?: string }) => {
      if (!activeTrip) {
        if (!canUseDriverDemo) throw new Error('Sem viagem ativa.');
        setDemoStops((prev) => prev.map((s) => {
          if (s.id !== stopId) return s;
          if (action === 'arrival') return { ...s, status: 'arrived', actual_arrival_at: new Date().toISOString() };
          if (action === 'depart') return { ...s, status: 'completed', actual_departure_at: new Date().toISOString() };
          return { ...s, status: action };
        }));
        return;
      }
      if (action === 'arrival') {
        const { error } = await supabase.rpc('driver_mark_arrival', { _stop_id: stopId });
        if (error) throw error;
        return;
      }
      if (action === 'depart') {
        // depart = finalize without POD info? Better: keep as 'completed' only via finalize_delivery.
        // For now keep a generic event via driver_create_event + status change via driver_update_stop_status('skipped').
        // Real "concluded" use case is delivery finalization in DriverDeliveries.
        const { error } = await supabase.rpc('driver_create_event', {
          _trip_id: activeTrip.id, _event_type: 'departure', _stop_id: stopId, _payload: {}, _notes: null,
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc('driver_update_stop_status', {
        _stop_id: stopId, _new_status: action, _reason: reason || null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
      toast({ title: 'Parada atualizada' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const handleArrival = (stopId: string) => {
    updateStop.mutate({ stopId, action: 'arrival' });
  };

  const handleDeparture = (stopId: string) => {
    updateStop.mutate({ stopId, action: 'depart' });
  };

  const openNavigation = (destination: string) => {
    window.open(`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(destination)}`, '_blank');
  };

  const isDemo = !activeTrip && canUseDriverDemo;
  const effectiveTrip: any = activeTrip || DEMO_TRIP;
  const effectiveStops: any[] = isDemo ? demoStops : (activeTrip ? (stops as any[]) : []);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Paradas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {effectiveTrip.loads?.load_number || '—'} · {effectiveStops.length} parada(s)
        </p>
      </div>

      {isDemo && (
        <DemoBanner
          message="Sem viagem ativa — paradas fictícias."
          onReset={() => setDemoStops(DEMO_STOPS_INITIAL)}
        />
      )}

      {effectiveStops.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma parada definida nesta viagem.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {effectiveStops.map((stop: any, idx: number) => (
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
                    Chegada: {new Date(stop.actual_arrival_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                    {stop.actual_departure_at && (
                      <> · Saída: {new Date(stop.actual_departure_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</>
                    )}
                  </div>
                )}

                <div className="flex gap-2">
                  {stop.destination && (
                    <Button variant="outline" size="sm" className="text-xs" onClick={() => openNavigation(stop.destination)}>
                      <Navigation className="h-3 w-3 mr-1" /> Navegar
                    </Button>
                  )}
                  {stop.status === 'pending' && (
                    <Button size="sm" className="text-xs" onClick={() => handleArrival(stop.id)} disabled={updateStop.isPending}>
                      <ArrowRight className="h-3 w-3 mr-1" /> Cheguei
                    </Button>
                  )}
                  {stop.status === 'arrived' && (
                    <Button size="sm" className="text-xs" onClick={() => handleDeparture(stop.id)} disabled={updateStop.isPending}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Concluir Parada
                    </Button>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
