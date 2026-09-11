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
  const snapshotMatches = !!operationalSnapshot && (!liveTripId || operationalSnapshot.tripId === liveTripId);
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
      const next: DriverOperationalSnapshot = { ...existing, cachedAt: new Date().toISOString(), checklist: {
        pre: { id: status.pre?.id ?? null, boundaryId: status.preBoundaryId, checkedItems: status.preItems },
        post: { id: status.post?.id ?? null, boundaryId: status.postBoundaryId, checkedItems: status.postItems },
      } };
      await driverOperationalSnapshotStore.put(next);
      setOperationalSnapshot(next);
    })().catch(() => { /* Checklist remains usable with live data. */ });
  }, [currentTenant?.id, status.isError, status.isLoading, status.post?.id, status.postBoundaryId,
    status.postItems, status.pre?.id, status.preBoundaryId, status.preItems, trip.data, user?.id]);
  const failed = (journey.isError || driver.isError || activeTrip.isError || trip.isError || status.isError) && !scopedSnapshot;
  const errorNotice = <div role="alert" className="space-y-2">
    <p>Não foi possível carregar o checklist e a viagem. Nenhuma marcação será salva até atualizar.</p>
    <Button onClick={() => { void driver.refetch(); void activeTrip.refetch(); void trip.refetch(); void status.refetch(); }}>Tentar novamente</Button>
  </div>;
  if (failed && !effectiveTrip) return errorNotice;
  if (!scopedSnapshot && (snapshotPending || journey.isPending || driver.isPending
    || (activeTrip.isPending && !ongoingTripId && !requestedTripId))) {
    return <p role="status">Carregando checklist…</p>;
  }
  if (!tripId) return <p>Nenhuma viagem disponível para checklist.</p>;
  if (!effectiveTrip) return <p role="status">Carregando checklist…</p>;
  const preItems = status.preItems.length || !scopedSnapshot ? status.preItems : scopedSnapshot.checklist.pre.checkedItems;
  const postItems = status.postItems.length || !scopedSnapshot ? status.postItems : scopedSnapshot.checklist.post.checkedItems;
  const preId = status.pre?.id ?? scopedSnapshot?.checklist.pre.id ?? null;
  const postId = status.post?.id ?? scopedSnapshot?.checklist.post.id ?? null;
  const preBoundaryId = status.preBoundaryId ?? scopedSnapshot?.checklist.pre.boundaryId ?? null;
  const postBoundaryId = status.postBoundaryId ?? scopedSnapshot?.checklist.post.boundaryId ?? null;
  const queuedStartBoundary = offlineCommands.commands.some(command => command.kind === 'journey'
    && command.aggregateId === effectiveTrip.id && command.payload && typeof command.payload === 'object'
    && !Array.isArray(command.payload) && command.payload.event_type === 'start_shift');
  return <div className="space-y-4">
    <h1 className="text-lg font-bold">Checklist</h1>
    {!trip.data && scopedSnapshot && <p role="status" className="text-xs text-muted-foreground">Dados salvos no aparelho. Novas marcações entrarão na fila de sincronização.</p>}
    {failed && errorNotice}
    {status.isLoading && !scopedSnapshot && <p role="status">Carregando checklist…</p>}
    <DriverChecklistSection key={`${effectiveTrip.id}-pre`} title="Pré-Viagem" kind="pre" items={PRE_TRIP_ITEMS}
      tripId={effectiveTrip.id} savedItems={preItems} savedId={preId}
      boundaryId={preBoundaryId} disabled={failed || effectiveTrip.status === 'completed'} />
    <DriverChecklistSection key={`${effectiveTrip.id}-post`} title="Pós-Viagem" kind="post" items={POST_TRIP_ITEMS}
      tripId={effectiveTrip.id} savedItems={postItems} savedId={postId}
      boundaryId={postBoundaryId} disabled={failed || (!postBoundaryId && !queuedStartBoundary)} />
  </div>;
}
