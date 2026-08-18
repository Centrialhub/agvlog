import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, CheckCircle, Clock, ArrowRight, Package } from 'lucide-react';
import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';

import { isStopTerminal, STOP_STATUS_LABELS } from '@/lib/status';


const STATUS_LABELS: Record<string, string> = STOP_STATUS_LABELS as any;

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

export default function DriverStops() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
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

  // Realtime: refresh stops when operator marks arrival/departure or updates status.
  useEffect(() => {
    if (!activeTrip?.id) return;
    const channel = supabase
      .channel(`driver_stops_${activeTrip.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_stops', filter: `dispatch_trip_id=eq.${activeTrip.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['driver_stops'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [activeTrip?.id, qc]);

  const updateStop = useMutation({
    mutationFn: async ({ stopId, action, reason }: { stopId: string; action: 'arrival' | 'depart' | 'skipped' | 'refused' | 'damaged' | 'returned' | 'partial_delivery'; reason?: string }) => {
      if (!activeTrip) throw new Error('Sem viagem ativa.');
      if (action === 'arrival') {
        const { error } = await supabase.rpc('driver_mark_arrival', { _stop_id: stopId });
        if (error) throw error;
        return;
      }
      if (action === 'depart') {
        // "Registrar saída" — apenas marca actual_departure_at e gera evento de departure.
        // A conclusão real da entrega acontece em DriverDeliveries via driver_finalize_delivery.
        const { error } = await supabase.rpc('driver_register_departure', {
          _stop_id: stopId, _notes: null,
        } as any);
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

  const effectiveTrip: any = activeTrip;
  const effectiveStops: any[] = activeTrip ? (stops as any[]) : [];

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Paradas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {effectiveTrip?.loads?.load_number || '—'} · {effectiveStops.length} parada(s)
        </p>
      </div>


      {!effectiveTrip?.id ? (
        <Card>
          <CardContent className="py-12 text-center space-y-4">
            <MapPin className="h-12 w-12 text-muted-foreground mx-auto opacity-20" />
            <div className="space-y-1">
              <p className="text-sm font-medium">Nenhuma viagem ativa</p>
              <p className="text-xs text-muted-foreground">
                Aguarde o despacho da carga pela operação para ver suas paradas.
              </p>
            </div>
            <Button variant="outline" size="sm" onClick={() => navigate('/driver')}>
              Voltar ao Início
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
                  {stop.status === 'pending' && !isStopTerminal(stop.status) && (
                    <Button size="sm" className="text-xs" onClick={() => handleArrival(stop.id)} disabled={updateStop.isPending}>
                      <ArrowRight className="h-3 w-3 mr-1" /> Cheguei
                    </Button>
                  )}
                  {stop.status === 'arrived' && !isStopTerminal(stop.status) && (
                    <Button size="sm" variant="outline" className="text-xs" onClick={() => handleDeparture(stop.id)} disabled={updateStop.isPending}>
                      <CheckCircle className="h-3 w-3 mr-1" /> Registrar saída
                    </Button>
                  )}
                  {isStopTerminal(stop.status) && (
                    <Badge variant="secondary" className="text-[10px]">Encerrada</Badge>
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
