import { useRef } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Clock, Play, Coffee, Moon, CheckCircle, ClipboardCheck } from 'lucide-react';
import { supabase } from '@/integrations/supabase/client';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useDriverJourneyContext } from '@/hooks/useDriverJourneyContext';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { canRecordJourneyEvent, getDriverJourneyState, type JourneyEventType } from '@/lib/driverJourney';
import { driverErrorMessage } from '@/lib/driverChecklist';

const eventLabels: Record<JourneyEventType, { label: string; icon: typeof Play }> = {
  start_shift: { label: 'Início de Jornada', icon: Play },
  lunch: { label: 'Almoço', icon: Coffee },
  rest: { label: 'Descanso', icon: Coffee },
  overnight: { label: 'Pernoite', icon: Moon },
  resume: { label: 'Retomada', icon: Play },
  end_shift: { label: 'Fim de Jornada', icon: CheckCircle },
};

export default function DriverJourney() {
  const { toast } = useToast();
  const qc = useQueryClient();
  const navigate = useNavigate();
  const driver = useCurrentDriver();
  const activeTrip = useActiveTrip(driver.data?.id);
  const journey = useDriverJourneyContext();
  const events = journey.data?.events ?? [];
  const latest = events.at(-1);
  const journeyState = getDriverJourneyState(events);
  // Finishing the final delivery must not strand an open shift on a completed trip.
  const tripId = latest && journeyState !== 'ended' ? latest.dispatch_trip_id : activeTrip.data?.id;
  const checklist = useChecklistStatus(tripId);
  const request = useRef<{ key: string; id: string } | null>(null);
  const unavailable = journey.isError || checklist.isError || driver.isError || (activeTrip.isError && !tripId);
  const loading = journey.isPending || checklist.isLoading;
  const refresh = () => Promise.all([
    qc.invalidateQueries({ queryKey: ['driver_journey_events'] }),
    qc.invalidateQueries({ queryKey: ['checklist_status'] }),
    qc.invalidateQueries({ queryKey: ['pod-history'] }),
    qc.invalidateQueries({ queryKey: ['product-history'] }),
    qc.invalidateQueries({ queryKey: ['driver_events'] }),
  ]);
  const addEvent = useMutation({
    mutationFn: async (eventType: JourneyEventType) => {
      if (!tripId || unavailable || loading) throw new Error('Atualize a viagem e a jornada antes de registrar.');
      const previousId = latest?.id ?? null;
      const key = `${tripId}:${eventType}:${previousId}`;
      if (request.current?.key !== key) request.current = { key, id: crypto.randomUUID() };
      const { error, data } = await supabase.rpc('driver_create_event', {
        _trip_id: tripId, _event_type: eventType,
        _payload: { source: 'driver_app', client_event_id: request.current.id, expected_previous_event_id: previousId },
      });
      if (error) throw error;
      return data;
    },
    onSuccess: async () => { toast({ title: 'Evento registrado' }); await refresh(); },
    onError: async (error: unknown) => {
      toast({ title: 'Erro', description: driverErrorMessage(error, 'Não foi possível registrar o evento.'), variant: 'destructive' });
      await refresh();
    },
  });
  const openChecklist = () => navigate(`/driver/checklist?trip=${encodeURIComponent(tripId ?? '')}`);
  const blockedByChecklist = (type: JourneyEventType) =>
    (type === 'start_shift' && !checklist.preCompleted) || (type === 'end_shift' && !checklist.postCompleted);
  const handleEventClick = (type: JourneyEventType) => {
    if (loading || unavailable || addEvent.isPending || !canRecordJourneyEvent(journeyState, type)) return;
    if (blockedByChecklist(type)) {
      toast({ title: `Checklist ${type === 'start_shift' ? 'pré' : 'pós'}-viagem obrigatório`,
        description: 'Complete e salve o checklist deste turno antes de continuar.', variant: 'destructive' });
      openChecklist();
    } else addEvent.mutate(type);
  };
  const stateLabel = { not_started: 'Não iniciada', working: 'Em atividade', paused: 'Em pausa', ended: 'Encerrada' }[journeyState];

  return <div className="space-y-4">
    <h1 className="text-lg font-bold">Jornada</h1>
    {unavailable && <Card role="alert"><CardContent className="p-3 space-y-2">
      <p className="text-sm">Não foi possível carregar a jornada ou o checklist. Atualize antes de registrar eventos.</p>
      <Button variant="outline" size="sm" onClick={() => { void checklist.refetch(); void journey.refetch(); void activeTrip.refetch(); void driver.refetch(); }}>Tentar novamente</Button>
    </CardContent></Card>}
    <Card><CardContent className="p-3 flex items-center justify-between">
      <span className="text-xs text-muted-foreground">Estado atual</span>
      <Badge role="status" variant={journeyState === 'ended' ? 'secondary' : 'default'}>
        {journey.isPending ? 'Carregando jornada…' : unavailable ? 'Estado indisponível' : stateLabel}
      </Badge>
    </CardContent></Card>
    {tripId ? <>
      {!loading && !unavailable && ((journeyState === 'not_started' || journeyState === 'ended')
        ? !checklist.preCompleted : !checklist.postCompleted) && <Card><CardContent className="p-3 space-y-2">
        <p className="text-xs">{journeyState === 'not_started' || journeyState === 'ended'
          ? 'Checklist pré-viagem pendente para este turno' : 'Checklist pós-viagem pendente para encerrar este turno'}</p>
        <Button size="sm" variant="outline" onClick={openChecklist}><ClipboardCheck className="h-3 w-3 mr-1" />Preencher</Button>
      </CardContent></Card>}
      <div className="grid grid-cols-2 gap-2">
        {(Object.entries(eventLabels) as [JourneyEventType, (typeof eventLabels)[JourneyEventType]][]).map(([type, { label, icon: Icon }]) =>
          <Button key={type} variant={blockedByChecklist(type) ? 'secondary' : 'outline'} size="sm" className="text-xs h-10"
            onClick={() => handleEventClick(type)} disabled={addEvent.isPending || loading || unavailable
              || journey.isFetching || checklist.isFetching || !canRecordJourneyEvent(journeyState, type)}>
            <Icon className="h-3.5 w-3.5 mr-1" />{label}
          </Button>)}
      </div>
    </> : <p className="text-sm text-muted-foreground">Aguardando liberação de viagem.</p>}
    {events.length > 0 && <Card><CardContent className="p-3 space-y-2">
      <h2 className="text-xs font-medium uppercase">Linha do tempo · últimos 100 eventos</h2>
      {events.map(event => <div key={event.id} className="flex items-center justify-between text-xs border-b pb-1.5">
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{eventLabels[event.event_type].label}</span>
        <time dateTime={event.event_at}>{new Date(event.event_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
      </div>)}
    </CardContent></Card>}
  </div>;
}
