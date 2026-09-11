import { useEffect, useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Clock, Play, Coffee, Moon, CheckCircle, ClipboardCheck } from 'lucide-react';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useDriverJourneyContext } from '@/hooks/useDriverJourneyContext';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { useToast } from '@/hooks/use-toast';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { canRecordJourneyEvent, getDriverJourneyState, type JourneyEventType } from '@/lib/driverJourney';
import { driverErrorMessage } from '@/lib/driverChecklist';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { readDriverRouteSnapshot } from '@/lib/driver/offlineRouteSnapshot';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';

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
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const driver = useCurrentDriver();
  const activeTrip = useActiveTrip(driver.data?.id);
  const journey = useDriverJourneyContext();
  const offlineCommands = useDriverOperationalOffline();
  const routeTripId = readDriverRouteSnapshot(currentTenant?.id, user?.id)?.trip.id;
  const snapshotTripId = activeTrip.data?.id ?? routeTripId;
  const [operationalSnapshot, setOperationalSnapshot] = useState<DriverOperationalSnapshot | null>(null);
  useEffect(() => {
    if (!currentTenant?.id || !user?.id || !snapshotTripId) { setOperationalSnapshot(null); return; }
    void driverOperationalSnapshotStore.read(currentTenant.id, user.id, snapshotTripId)
      .then(setOperationalSnapshot).catch(() => setOperationalSnapshot(null));
  }, [currentTenant?.id, snapshotTripId, user?.id]);
  const cachedEvents = operationalSnapshot?.journey.events.map(event => ({ id: event.id,
    dispatch_trip_id: event.tripId, event_type: event.type, event_at: event.eventAt, created_at: event.eventAt })) ?? [];
  const queuedJourney = offlineCommands.commands.filter(command => command.kind === 'journey')
    .flatMap(command => {
      if (!command.payload || typeof command.payload !== 'object' || Array.isArray(command.payload)
        || typeof command.payload.event_type !== 'string' || typeof command.payload.trip_id !== 'string') return [];
      return [{ id: command.id, dispatch_trip_id: command.payload.trip_id,
        event_type: command.payload.event_type as JourneyEventType,
        event_at: command.createdAt, created_at: command.createdAt, offline_pending: true }];
    });
  const events = [...(journey.data?.events ?? cachedEvents), ...queuedJourney];
  const latest = events.at(-1);
  const journeyState = getDriverJourneyState(events);
  // Finishing the final delivery must not strand an open shift on a completed trip.
  const tripId = latest && journeyState !== 'ended' ? latest.dispatch_trip_id : activeTrip.data?.id;
  const checklist = useChecklistStatus(tripId);
  const unavailable = (journey.isError && !operationalSnapshot) || (checklist.isError && !operationalSnapshot)
    || (driver.isError && !operationalSnapshot) || (activeTrip.isError && !tripId);
  const loading = (journey.isPending || checklist.isLoading) && !operationalSnapshot;

  useEffect(() => {
    if (!currentTenant?.id || !user?.id || !tripId || !journey.data) return;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(currentTenant.id, user.id, tripId);
      if (!existing) return;
      const next: DriverOperationalSnapshot = { ...existing, cachedAt: new Date().toISOString(), journey: {
        events: journey.data.events.map(event => ({ id: event.id, tripId: event.dispatch_trip_id,
          type: event.event_type, eventAt: event.event_at })),
        lastStartId: journey.data.last_start?.id ?? null, lastEndId: journey.data.last_end?.id ?? null,
      } };
      await driverOperationalSnapshotStore.put(next);
      setOperationalSnapshot(next);
    })().catch(() => { /* Journey remains usable with live data. */ });
  }, [currentTenant?.id, journey.data, tripId, user?.id]);
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
      const latestQueued = queuedJourney.at(-1);
      return offlineCommands.submit({
        kind: 'journey', aggregateId: tripId,
        payload: { trip_id: tripId, event_type: eventType,
          event_payload: { source: 'driver_app', expected_previous_event_id: latestQueued ? null : latest?.id ?? null,
            expected_previous_request_id: latestQueued?.id ?? null } },
      });
    },
    onSuccess: async result => {
      toast({ title: result.queued ? 'Evento salvo no aparelho' : 'Evento registrado',
        description: result.queued ? 'A jornada será sincronizada automaticamente.' : undefined });
      if (!result.queued) await refresh();
    },
    onError: async (error: unknown) => {
      toast({ title: 'Erro', description: driverErrorMessage(error, 'Não foi possível registrar o evento.'), variant: 'destructive' });
      await refresh();
    },
  });
  const openChecklist = () => navigate(`/driver/checklist?trip=${encodeURIComponent(tripId ?? '')}`);
  const queuedChecklists = offlineCommands.commands.filter(command => command.kind === 'checklist'
    && command.aggregateId === tripId && command.payload && typeof command.payload === 'object' && !Array.isArray(command.payload));
  const queuedChecklistCompleted = (kind: 'pre' | 'post', total: number) => queuedChecklists.some(command => {
    const payload = command.payload as Record<string, unknown>;
    const checklistPayload = payload.checklist_payload;
    return payload.kind === kind && !!checklistPayload && typeof checklistPayload === 'object'
      && Array.isArray((checklistPayload as Record<string, unknown>).checked_items)
      && (checklistPayload as Record<string, unknown>).checked_items instanceof Array
      && ((checklistPayload as Record<string, unknown>).checked_items as unknown[]).length === total;
  });
  const preCompleted = checklist.preCompleted
    || operationalSnapshot?.checklist.pre.checkedItems.length === checklist.preTotalCount
    || queuedChecklistCompleted('pre', checklist.preTotalCount);
  const postCompleted = checklist.postCompleted
    || operationalSnapshot?.checklist.post.checkedItems.length === checklist.postTotalCount
    || queuedChecklistCompleted('post', checklist.postTotalCount);
  const blockedByChecklist = (type: JourneyEventType) =>
    (type === 'start_shift' && !preCompleted) || (type === 'end_shift' && !postCompleted);
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
        {journey.isPending && !operationalSnapshot ? 'Carregando jornada…' : unavailable ? 'Estado indisponível' : stateLabel}
      </Badge>
    </CardContent></Card>
    {tripId ? <>
      {!loading && !unavailable && ((journeyState === 'not_started' || journeyState === 'ended')
          ? !preCompleted : !postCompleted) && <Card><CardContent className="p-3 space-y-2">
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
        <span className="flex items-center gap-1"><Clock className="h-3 w-3" />{eventLabels[event.event_type].label}
          {'offline_pending' in event && event.offline_pending ? ' · pendente' : ''}</span>
        <time dateTime={event.event_at}>{new Date(event.event_at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</time>
      </div>)}
    </CardContent></Card>}
  </div>;
}
