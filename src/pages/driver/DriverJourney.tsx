import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Clock, Play, Coffee, Moon, CheckCircle, ClipboardCheck, AlertTriangle } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useEffect, useState } from 'react';
import DemoBanner from '@/components/driver/DemoBanner';
import { canUseDriverDemo } from '@/lib/driver/demoMode';

const eventLabels: Record<string, { label: string; icon: typeof Play }> = {
  start_shift: { label: 'Início de Jornada', icon: Play },
  lunch: { label: 'Almoço', icon: Coffee },
  rest: { label: 'Descanso', icon: Coffee },
  overnight: { label: 'Pernoite', icon: Moon },
  resume: { label: 'Retomada', icon: Play },
  end_shift: { label: 'Fim de Jornada', icon: CheckCircle },
};

const DEMO_EVENTS_INITIAL: any[] = [
  { id: 'j1', event_type: 'start_shift', event_at: new Date(new Date().setHours(5, 0, 0, 0)).toISOString() },
  { id: 'j2', event_type: 'lunch',       event_at: new Date(new Date().setHours(12, 0, 0, 0)).toISOString() },
  { id: 'j3', event_type: 'resume',      event_at: new Date(new Date().setHours(13, 30, 0, 0)).toISOString() },
];

export default function DriverJourney() {
  const { currentTenant } = useTenant();
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const { data: driver } = useCurrentDriver();
  const { data: trip } = useActiveTrip(driver?.id);
  const checklist = useChecklistStatus(trip?.id);
  const [demoEvents, setDemoEvents] = useState<any[]>(DEMO_EVENTS_INITIAL);

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

  // Realtime: sync journey events created by other clients (e.g. operator).
  useEffect(() => {
    if (!trip?.id) return;
    const channel = supabase
      .channel(`driver_journey_${trip.id}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'dispatch_events', filter: `dispatch_trip_id=eq.${trip.id}` },
        () => {
          qc.invalidateQueries({ queryKey: ['driver_journey_events'] });
        },
      )
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
  }, [trip?.id, qc]);

  const addEvent = useMutation({
    mutationFn: async (eventType: string) => {
      if (!trip || !currentTenant) {
        // Demo
        setDemoEvents((prev) => [...prev, { id: 'd' + Date.now(), event_type: eventType, event_at: new Date().toISOString() }]);
        return;
      }
      const { error } = await supabase.rpc('driver_create_event', {
        _trip_id: trip.id,
        _event_type: eventType,
        _payload: { source: 'driver_app' } as any,
        _stop_id: null,
        _notes: null,
      } as any);
      if (error) throw error;
    },
    onSuccess: () => {
      toast({ title: 'Evento registrado' });
      qc.invalidateQueries({ queryKey: ['driver_journey_events'] });
    },
    onError: (e: any) => toast({ title: 'Erro', description: e.message, variant: 'destructive' }),
  });

  const isDemo = canUseDriverDemo && !trip && !driver;
  const effectiveEvents = isDemo ? demoEvents : events;

  const handleEventClick = (eventType: string) => {
    if (!isDemo && eventType === 'start_shift' && !checklist.preCompleted) {
      toast({
        title: 'Checklist pré-viagem obrigatório',
        description: 'Complete o checklist pré-viagem antes de iniciar a jornada.',
        variant: 'destructive',
      });
      navigate('/driver/checklist');
      return;
    }
    if (!isDemo && eventType === 'end_shift' && !checklist.postCompleted) {
      toast({
        title: 'Checklist pós-viagem obrigatório',
        description: 'Complete o checklist pós-viagem antes de encerrar a jornada.',
        variant: 'destructive',
      });
      navigate('/driver/checklist');
      return;
    }
    addEvent.mutate(eventType);
  };

  const isEventBlocked = (eventType: string) => {
    if (isDemo) return false;
    if (eventType === 'start_shift' && !checklist.preCompleted) return true;
    if (eventType === 'end_shift' && !checklist.postCompleted) return true;
    return false;
  };

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">Jornada</h1>

      {isDemo && (
        <DemoBanner
          message="Sem viagem ativa — jornada fictícia."
          onReset={() => setDemoEvents(DEMO_EVENTS_INITIAL)}
        />
      )}

      {(trip || isDemo) ? (
        <>
          {/* Checklist warnings */}
          {!isDemo && !checklist.isLoading && !checklist.preCompleted && (
            <Card className="border-warning/50 bg-warning/5">
              <CardContent className="p-3 flex items-center gap-3">
                <AlertTriangle className="h-5 w-5 text-warning shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium">Checklist pré-viagem pendente</p>
                  <p className="text-[10px] text-muted-foreground">
                    {checklist.preCheckedCount}/{checklist.preTotalCount} itens · Obrigatório para iniciar jornada
                  </p>
                </div>
                <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={() => navigate('/driver/checklist')}>
                  <ClipboardCheck className="h-3 w-3 mr-1" />
                  Preencher
                </Button>
              </CardContent>
            </Card>
          )}

          {!isDemo && !checklist.isLoading && checklist.preCompleted && !checklist.postCompleted && (
            <Card className="border-blue-200 bg-blue-50/50">
              <CardContent className="p-3 flex items-center gap-3">
                <ClipboardCheck className="h-5 w-5 text-blue-500 shrink-0" />
                <div className="flex-1">
                  <p className="text-xs font-medium">Checklist pós-viagem pendente</p>
                  <p className="text-[10px] text-muted-foreground">
                    {checklist.postCheckedCount}/{checklist.postTotalCount} itens · Obrigatório para encerrar jornada
                  </p>
                </div>
                <Button size="sm" variant="outline" className="text-xs shrink-0" onClick={() => navigate('/driver/checklist')}>
                  <ClipboardCheck className="h-3 w-3 mr-1" />
                  Preencher
                </Button>
              </CardContent>
            </Card>
          )}

          <div className="grid grid-cols-2 gap-2">
            {Object.entries(eventLabels).map(([key, { label, icon: Icon }]) => {
              const blocked = isEventBlocked(key);
              return (
                <Button
                  key={key}
                  variant={blocked ? 'secondary' : 'outline'}
                  size="sm"
                  className={`flex items-center gap-1.5 text-xs h-10 ${blocked ? 'opacity-60' : ''}`}
                  onClick={() => handleEventClick(key)}
                  disabled={addEvent.isPending}
                >
                  {blocked ? (
                    <ClipboardCheck className="h-3.5 w-3.5 text-warning" />
                  ) : (
                    <Icon className="h-3.5 w-3.5" />
                  )}
                  {label}
                </Button>
              );
            })}
          </div>

          {effectiveEvents.length > 0 && (
            <Card>
              <CardContent className="p-3 space-y-2">
                <p className="text-xs font-medium text-muted-foreground uppercase">Linha do tempo</p>
                {effectiveEvents.map((e: any) => {
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

          {effectiveEvents.length === 0 && (
            <Card>
              <CardContent className="py-6 text-center">
                <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
                <p className="text-sm text-muted-foreground">Registre os eventos da sua jornada.</p>
              </CardContent>
            </Card>
          )}
        </>
      ) : (
        <Card>
          <CardContent className="py-6 text-center">
            <Clock className="h-8 w-8 text-muted-foreground mx-auto mb-2" />
            <p className="text-sm text-muted-foreground">Seu veículo ainda não possui uma viagem ativa.</p>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
