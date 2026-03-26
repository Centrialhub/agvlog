import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Play, Coffee, Moon, CheckCircle } from 'lucide-react';

const eventLabels: Record<string, { label: string; icon: typeof Play }> = {
  start_shift: { label: 'Início de Jornada', icon: Play },
  lunch: { label: 'Almoço', icon: Coffee },
  rest: { label: 'Descanso', icon: Coffee },
  overnight: { label: 'Pernoite', icon: Moon },
  resume: { label: 'Retomada', icon: Play },
  end_shift: { label: 'Fim de Jornada', icon: CheckCircle },
};

export default function DriverJourney() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);

  const { data: events = [] } = useQuery({
    queryKey: ['driver_journey_events', trip?.id],
    queryFn: async () => {
      if (!trip) return [];
      const { data, error } = await supabase
        .from('dispatch_events')
        .select('*')
        .eq('dispatch_trip_id', trip.id)
        .in('event_type', Object.keys(eventLabels))
        .order('event_at', { ascending: true });
      if (error) throw error;
      return data || [];
    },
    enabled: !!trip?.id,
  });

  const addEvent = useMutation({
    mutationFn: async (eventType: string) => {
      if (!trip || !currentTenant) throw new Error('Nenhuma viagem ativa');
      const { error } = await supabase.from('dispatch_events').insert({
        tenant_id: currentTenant.id,
        dispatch_trip_id: trip.id,
        event_type: eventType,
        event_at: new Date().toISOString(),
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Evento registrado' });
      qc.invalidateQueries({ queryKey: ['driver_journey_events'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Jornada</h1>

      {!trip && (
        <Card>
          <CardContent className="py-6 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Nenhuma viagem ativa para registrar jornada.</p>
          </CardContent>
        </Card>
      )}

      {trip && (
        <>
          <div className="grid grid-cols-2 gap-2">
            {Object.entries(eventLabels).map(([key, { label, icon: Icon }]) => (
              <Button key={key} variant="outline" size="sm" className="flex items-center gap-1.5 text-xs h-10" onClick={() => addEvent.mutate(key)} disabled={addEvent.isPending}>
                <Icon className="h-3.5 w-3.5" />
                {label}
              </Button>
            ))}
          </div>

          {events.length > 0 && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">Linha do tempo</p>
                {events.map((e: any) => {
                  const meta = eventLabels[e.event_type];
                  return (
                    <div key={e.id} className="flex items-center justify-between text-xs border-b last:border-0 pb-1.5">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3 text-muted-foreground" />
                        <span>{meta?.label || e.event_type}</span>
                      </div>
                      <Badge variant="secondary" className="text-[10px]">
                        {new Date(e.event_at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                      </Badge>
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          )}

          {events.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center">
                <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Registre os eventos da sua jornada.</p>
              </CardContent>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
