import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useDriverJourneyContext } from '@/hooks/useDriverJourneyContext';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { DriverChecklistSection } from '@/components/driver/DriverChecklistSection';
import { PRE_TRIP_ITEMS, POST_TRIP_ITEMS } from '@/lib/driverChecklist';
import { Button } from '@/components/ui/button';
import { driverOperationalSnapshotStore, type DriverOperationalSnapshot } from '@/lib/driver/driverOperationalOffline';
import { useDriverOperationalOffline } from '@/hooks/useDriverOperationalOffline';

function accessDenied(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const code = 'code' in error ? String(error.code) : '';
  return ['401', '403', '42501', 'PGRST301', 'PGRST302', 'PGRST116'].includes(code);
}

function hasChecklistContext(snapshot: DriverOperationalSnapshot): boolean {
  return (['pre', 'post'] as const).every(kind => {
    const checklist = snapshot.checklist?.[kind];
    const count = kind === 'pre' ? PRE_TRIP_ITEMS.length : POST_TRIP_ITEMS.length;
    return !!checklist && Array.isArray(checklist.checkedItems)
      && checklist.checkedItems.every(item => Number.isInteger(item) && item >= 0 && item < count)
      && (checklist.id === null || typeof checklist.id === 'string')
      && (checklist.boundaryId === null || typeof checklist.boundaryId === 'string');
  });
}

export default function DriverChecklist() {
  const [params] = useSearchParams();
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const offlineCommands = useDriverOperationalOffline();
  const driver = useCurrentDriver();
  const activeTrip = useActiveTrip(driver.data?.id);
  const journey = useDriverJourneyContext();
  const latest = journey.data?.events.at(-1);
  const ongoingTripId = latest && latest.event_type !== 'end_shift' ? latest.dispatch_trip_id : undefined;
  const requestedTripId = params.get('trip');
  const [operationalSnapshot, setOperationalSnapshot] = useState<DriverOperationalSnapshot | null>(null);
  const [snapshotPending, setSnapshotPending] = useState(true);
  useEffect(() => {
    let active = true;
    setOperationalSnapshot(null);
    if (!currentTenant?.id || !user?.id) { setSnapshotPending(false); return () => { active = false; }; }
    setSnapshotPending(true);
    const read = requestedTripId
      ? driverOperationalSnapshotStore.read(currentTenant.id, user.id, requestedTripId)
      : driverOperationalSnapshotStore.readLatest(currentTenant.id, user.id);
    void read.then(snapshot => { if (active) setOperationalSnapshot(snapshot); })
      .catch(() => { if (active) setOperationalSnapshot(null); })
      .finally(() => { if (active) setSnapshotPending(false); });
    return () => { active = false; };
  }, [currentTenant?.id, requestedTripId, user?.id]);
  const liveTripId = requestedTripId || ongoingTripId || activeTrip.data?.id;
  const snapshotMatches = !!operationalSnapshot && hasChecklistContext(operationalSnapshot)
    && operationalSnapshot.tenantId === currentTenant?.id && operationalSnapshot.actorId === user?.id
    && (!liveTripId || operationalSnapshot.tripId === liveTripId)
    && (!driver.data || operationalSnapshot.trip.driver.id === driver.data.id);
  const scopedSnapshot = snapshotMatches ? operationalSnapshot : null;
  const tripId = liveTripId || scopedSnapshot?.tripId;
  const trip = useQuery({
    queryKey: ['driver_checklist_trip', currentTenant?.id, driver.data?.id, tripId],
    enabled: !!tripId && !!currentTenant && !!driver.data,
    queryFn: async () => {
      const { data, error } = await supabase.from('dispatch_trips').select('id,status')
        .eq('id', tripId!).eq('tenant_id', currentTenant!.id).eq('driver_id', driver.data!.id).maybeSingle();
      if (error) throw error;
      if (!data || !['planned','loading','dispatched','in_transit','in_progress','completed'].includes(data.status)) {
        throw new Error('Viagem indisponível para este motorista');
      }
      return data;
    },
  });
  const status = useChecklistStatus(trip.data?.id ?? scopedSnapshot?.tripId);
  const effectiveTrip = trip.data ?? (scopedSnapshot ? { id: scopedSnapshot.tripId, status: scopedSnapshot.trip.status } : null);
  useEffect(() => {
    if (!currentTenant?.id || !user?.id || !trip.data || status.isError || status.isLoading) return;
    void (async () => {
      const existing = await driverOperationalSnapshotStore.read(currentTenant.id, user.id, trip.data.id);
      if (!existing) return;
      const checklist: DriverOperationalSnapshot['checklist'] = {
        pre: { id: status.pre?.id ?? null, boundaryId: status.preBoundaryId, checkedItems: status.preItems },
        post: { id: status.post?.id ?? null, boundaryId: status.postBoundaryId, checkedItems: status.postItems },
      };
      if (JSON.stringify(existing.checklist) === JSON.stringify(checklist)) return;
      const next = { ...existing, cachedAt: new Date().toISOString(), checklist };
      await driverOperationalSnapshotStore.put(next);
      setOperationalSnapshot(next);
    })().catch(() => { /* Checklist remains usable with live data. */ });
  }, [currentTenant?.id, status.isError, status.isLoading, status.post?.id, status.postBoundaryId,
    status.postItems, status.pre?.id, status.preBoundaryId, status.preItems, trip.data, user?.id]);
  const denied = accessDenied(driver.error) || accessDenied(journey.error) || accessDenied(trip.error) || accessDenied(activeTrip.error)
    || (driver.isSuccess && (!driver.data || !driver.data.active))
    || (trip.isError && trip.error.message === 'Viagem indisponível para este motorista');
  const failed = denied || ((journey.isError || driver.isError || activeTrip.isError || trip.isError || status.isError) && (!scopedSnapshot || offlineCommands.online));
  const offlineUnavailable = !offlineCommands.online && !snapshotPending && !scopedSnapshot
    && (!effectiveTrip || journey.isPending || driver.isPending || status.isLoading);
  const errorNotice = <div role="alert" className="space-y-2">
    <p>Não foi possível carregar o checklist e a viagem. Nenhuma marcação será salva até atualizar.</p>
    <Button onClick={() => { void driver.refetch(); void activeTrip.refetch(); void trip.refetch(); void status.refetch(); }}>Tentar novamente</Button>
  </div>;
  if (denied) return errorNotice;
  if (offlineUnavailable) return <div role="alert" className="space-y-2">
    <p>Checklist indisponível offline. Não há dados completos salvos para esta viagem e sessão. Conecte-se para carregar antes de marcar ou salvar.</p>
  </div>;
  if (failed && !effectiveTrip) return errorNotice;
  if (!scopedSnapshot && (snapshotPending || journey.isPending || driver.isPending
    || (activeTrip.isPending && !ongoingTripId && !requestedTripId))) {
    return <p role="status">Carregando checklist…</p>;
  }
  if (!tripId) return <p>Nenhuma viagem disponível para checklist.</p>;
  if (!effectiveTrip) return <p role="status">Carregando checklist…</p>;
  const savedChecklist = status.isLoading || status.isError ? scopedSnapshot?.checklist : null;
  const preItems = savedChecklist ? savedChecklist.pre.checkedItems : status.preItems;
  const postItems = savedChecklist ? savedChecklist.post.checkedItems : status.postItems;
  const preId = savedChecklist ? savedChecklist.pre.id : status.pre?.id ?? null;
  const postId = savedChecklist ? savedChecklist.post.id : status.post?.id ?? null;
  const preBoundaryId = savedChecklist ? savedChecklist.pre.boundaryId : status.preBoundaryId;
  const postBoundaryId = savedChecklist ? savedChecklist.post.boundaryId : status.postBoundaryId;
  const disabled = failed || (status.isLoading && !scopedSnapshot);
  const queuedStartBoundary = offlineCommands.commands.some(command => command.kind === 'journey'
    && command.aggregateId === effectiveTrip.id && command.payload && typeof command.payload === 'object'
    && !Array.isArray(command.payload) && command.payload.event_type === 'start_shift');
  return <div className="space-y-4">
    <h1 className="text-lg font-bold">Checklist</h1>
    {!trip.data && scopedSnapshot && !failed && <p role="status" className="text-xs text-muted-foreground">Dados salvos no aparelho. Novas marcações entrarão na fila de sincronização.</p>}
    {failed && errorNotice}
    {status.isLoading && !scopedSnapshot && <p role="status">Carregando checklist…</p>}
    <DriverChecklistSection key={`${effectiveTrip.id}-pre`} title="Pré-Viagem" kind="pre" items={PRE_TRIP_ITEMS}
      tripId={effectiveTrip.id} savedItems={preItems} savedId={preId}
      boundaryId={preBoundaryId} disabled={disabled || effectiveTrip.status === 'completed'} />
    <DriverChecklistSection key={`${effectiveTrip.id}-post`} title="Pós-Viagem" kind="post" items={POST_TRIP_ITEMS}
      tripId={effectiveTrip.id} savedItems={postItems} savedId={postId}
      boundaryId={postBoundaryId} disabled={disabled || (!postBoundaryId && !queuedStartBoundary)} />
  </div>;
}
