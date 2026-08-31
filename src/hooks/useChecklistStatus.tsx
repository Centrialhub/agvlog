import { useEffect, useId } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { checklistItems, PRE_TRIP_ITEMS, POST_TRIP_ITEMS } from '@/lib/driverChecklist';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import { useDriverJourneyContext } from './useDriverJourneyContext';

export function useChecklistStatus(tripId: string | undefined) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const journey = useDriverJourneyContext();
  const qc = useQueryClient();
  const subscriptionId = useId();
  const preBoundary = journey.data?.last_end ?? null;
  const postBoundary = journey.data?.last_start ?? null;
  const query = useQuery({
    queryKey: ['checklist_status', currentTenant?.id, user?.id, tripId, preBoundary?.id, postBoundary?.id],
    enabled: !!tripId && !!currentTenant && !!user && journey.isSuccess,
    queryFn: async () => {
      if (!tripId || !currentTenant || !user) throw new Error('Viagem ou sessão indisponível');
      const read = async (kind: 'pre' | 'post', after: string | undefined) => {
        let request = supabase.from('dispatch_events').select('id,payload,event_at')
          .eq('tenant_id', currentTenant.id).eq('created_by', user.id)
          .eq('dispatch_trip_id', tripId).eq('event_type', `checklist_${kind}`)
          .order('event_at', { ascending: false }).order('created_at', { ascending: false })
          .order('id', { ascending: false }).limit(1);
        if (after) request = request.gt('event_at', after);
        const { data, error } = await request.maybeSingle();
        if (error) throw error;
        return data;
      };
      const [pre, post] = await Promise.all([read('pre', preBoundary?.event_at), read('post', postBoundary?.event_at)]);
      return { pre, post };
    },
  });
  useEffect(() => {
    if (!user?.id || !currentTenant?.id) return;
    const channel = supabase.channel(`driver_checklists_${subscriptionId}`)
      .on('postgres_changes', {
        event: '*', schema: 'public', table: 'dispatch_events', filter: `created_by=eq.${user.id}`,
      }, () => {
        void qc.invalidateQueries({ queryKey: ['driver_journey_events', currentTenant.id, user.id] });
        void qc.invalidateQueries({ queryKey: ['checklist_status', currentTenant.id, user.id] });
      }).subscribe();
    return () => { void supabase.removeChannel(channel); };
  }, [user?.id, currentTenant?.id, qc, subscriptionId]);

  const preItems = checklistItems(query.data?.pre?.payload, PRE_TRIP_ITEMS.length);
  const postItems = checklistItems(query.data?.post?.payload, POST_TRIP_ITEMS.length);
  const isError = query.isError || journey.isError;
  return {
    preCompleted: !isError && preItems.length === PRE_TRIP_ITEMS.length,
    postCompleted: !isError && !!postBoundary && postItems.length === POST_TRIP_ITEMS.length,
    preCheckedCount: preItems.length, postCheckedCount: postItems.length,
    preTotalCount: PRE_TRIP_ITEMS.length, postTotalCount: POST_TRIP_ITEMS.length,
    preItems, postItems, pre: query.data?.pre, post: query.data?.post,
    preBoundaryId: preBoundary?.id ?? null, postBoundaryId: postBoundary?.id ?? null,
    isLoading: journey.isPending || query.isPending,
    isFetching: journey.isFetching || query.isFetching,
    isError,
    refetch: async () => { await journey.refetch(); await query.refetch(); },
  };
}
