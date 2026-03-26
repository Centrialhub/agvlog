import { useSearchParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { MapPin, Navigation, CheckCircle, Clock, ArrowRight } from 'lucide-react';

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
  const tripId = searchParams.get('trip');

  const { data: trip } = useQuery({
    queryKey: ['driver_trip_active', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return null;
      const query = supabase
        .from('dispatch_trips')
        .select('*, loads(load_number, origin, destination)')
        .eq('tenant_id', currentTenant.id)
        .in('status', ['planned', 'in_progress'])
        .order('created_at', { ascending: false })
        .limit(1);

      if (tripId) {
        const { data, error } = await supabase
          .from('dispatch_trips')
          .select('*, loads(load_number, origin, destination)')
          .eq('id', tripId)
          .eq('tenant_id', currentTenant.id)
          .maybeSingle();
        if (error) throw error;
        return data;
      }

      const { data, error } = await query.maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!currentTenant,
  });

  const { data: stops = [] } = useQuery({
    queryKey: ['driver_stops', trip?.id],
    queryFn: async () => {
      if (!trip) return [];
      const { data, error } = await supabase
        .from('dispatch_stops')
        .select('*, clients(company_name)')
        .eq('dispatch_trip_id', trip.id)
        .order('stop_order', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!trip?.id,
  });

  const updateStop = useMutation({
    mutationFn: async ({ stopId, updates }: { stopId: string; updates: Record<string, any> }) => {
      const { error } = await supabase
        .from('dispatch_stops')
        .update({ ...updates, updated_at: new Date().toISOString() })
        .eq('id', stopId);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['driver_stops'] });
      toast({ title: 'Parada atualizada' });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const handleArrival = (stopId: string) => {
    updateStop.mutate({
      stopId,
      updates: { status: 'arrived', actual_arrival_at: new Date().toISOString() },
    });
  };

  const handleDeparture = (stopId: string) => {
    updateStop.mutate({
      stopId,
      updates: { status: 'completed', actual_departure_at: new Date().toISOString() },
    });
  };

  const openNavigation = (destination: string) => {
    const encoded = encodeURIComponent(destination);
    window.open(`https://www.google.com/maps/search/?api=1&query=${encoded}`, '_blank');
  };

  if (!trip) {
    return (
      <div className="space-y-4">
        <h1 className="text-lg font-bold">Paradas</h1>
        <Card>
          <CardContent className="py-8 text-center">
            <MapPin className="h-10 w-10 text-muted-foreground mx-auto mb-3" />
            <p className="text-sm text-muted-foreground">Nenhuma viagem ativa.</p>
            <p className="text-xs text-muted-foreground mt-1">As paradas aparecerão quando uma viagem for atribuída.</p>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-lg font-bold">Paradas</h1>
        <p className="text-xs text-muted-foreground">
          Carga {(trip as any).loads?.load_number || '—'} · {stops.length} parada(s)
        </p>
      </div>

      {stops.length === 0 ? (
        <Card>
          <CardContent className="py-6 text-center">
            <p className="text-sm text-muted-foreground">Nenhuma parada definida nesta viagem.</p>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-3">
          {stops.map((stop: any, idx: number) => (
            <Card key={stop.id} className={stop.status === 'arrived' ? 'border-primary' : ''}>
              <CardContent className="p-4 space-y-3">
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex h-6 w-6 items-center justify-center rounded-full bg-muted text-xs font-bold">
                      {idx + 1}
                    </div>
                    <div>
                      <p className="text-sm font-medium">
                        {(stop as any).clients?.company_name || stop.destination || `Parada ${idx + 1}`}
                      </p>
                      {stop.destination && !(stop as any).clients?.company_name && null}
                      {stop.destination && (stop as any).clients?.company_name && (
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
                      <>
                        {' · '}Saída: {new Date(stop.actual_departure_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </>
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
