import { useQuery } from '@tanstack/react-query';
import { useSearchParams } from 'react-router-dom';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { useCurrentDriver, useActiveTrip } from '@/hooks/useCurrentDriver';
import { useDriverJourneyContext } from '@/hooks/useDriverJourneyContext';
import { useChecklistStatus } from '@/hooks/useChecklistStatus';
import { DriverChecklistSection } from '@/components/driver/DriverChecklistSection';
import { PRE_TRIP_ITEMS, POST_TRIP_ITEMS } from '@/lib/driverChecklist';
import { Button } from '@/components/ui/button';

export default function DriverChecklist() {
  const [params] = useSearchParams();
  const { currentTenant } = useTenant();
  const driver = useCurrentDriver();
  const activeTrip = useActiveTrip(driver.data?.id);
  const journey = useDriverJourneyContext();
  const latest = journey.data?.events.at(-1);
  const ongoingTripId = latest && latest.event_type !== 'end_shift' ? latest.dispatch_trip_id : undefined;
  const tripId = params.get('trip') || ongoingTripId || activeTrip.data?.id;
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
  const status = useChecklistStatus(trip.data?.id);
  const failed = journey.isError || driver.isError || activeTrip.isError || trip.isError || status.isError;
  const errorNotice = <div role="alert" className="space-y-2">
    <p>Não foi possível carregar o checklist e a viagem. Nenhuma marcação será salva até atualizar.</p>
    <Button onClick={() => { void driver.refetch(); void activeTrip.refetch(); void trip.refetch(); void status.refetch(); }}>Tentar novamente</Button>
  </div>;
  if (failed && !trip.data) return errorNotice;
  if (journey.isPending || driver.isPending || (activeTrip.isPending && !ongoingTripId && !params.get('trip'))) {
    return <p role="status">Carregando checklist…</p>;
  }
  if (!tripId) return <p>Nenhuma viagem disponível para checklist.</p>;
  if (!trip.data) return <p role="status">Carregando checklist…</p>;
  return <div className="space-y-4">
    <h1 className="text-lg font-bold">Checklist</h1>
    {failed && errorNotice}
    {status.isLoading && <p role="status">Carregando checklist…</p>}
    <DriverChecklistSection key={`${trip.data.id}-pre`} title="Pré-Viagem" kind="pre" items={PRE_TRIP_ITEMS}
      tripId={trip.data.id} savedItems={status.preItems} savedId={status.pre?.id ?? null}
      boundaryId={status.preBoundaryId} disabled={failed || status.isLoading || status.isFetching || trip.data.status === 'completed'} />
    <DriverChecklistSection key={`${trip.data.id}-post`} title="Pós-Viagem" kind="post" items={POST_TRIP_ITEMS}
      tripId={trip.data.id} savedItems={status.postItems} savedId={status.post?.id ?? null}
      boundaryId={status.postBoundaryId} disabled={failed || status.isLoading || status.isFetching || !status.postBoundaryId} />
  </div>;
}
