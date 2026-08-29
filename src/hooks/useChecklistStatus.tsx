import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Json } from '@/integrations/supabase/types';
import { useTenant } from './useTenant';

const PRE_TRIP_TOTAL = 8;
const POST_TRIP_TOTAL = 5;

function checkedItemCount(payload: Json | null | undefined): number {
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) return 0;
  return Array.isArray(payload.checked_items) ? payload.checked_items.length : 0;
}

export interface ChecklistStatus {
  preCompleted: boolean;
  postCompleted: boolean;
  preCheckedCount: number;
  postCheckedCount: number;
  preTotalCount: number;
  postTotalCount: number;
  isLoading: boolean;
}

export function useChecklistStatus(tripId: string | undefined): ChecklistStatus {
  const { currentTenant } = useTenant();
  const { data, isLoading } = useQuery({
    queryKey: ['checklist_status', currentTenant?.id, tripId],
    queryFn: async () => {
      try {
        if (!tripId || !currentTenant) return { pre: null, post: null };
        const { data: events, error } = await supabase
          .from('dispatch_events')
          .select('event_type, payload')
          .eq('tenant_id', currentTenant.id)
          .eq('dispatch_trip_id', tripId)
          .in('event_type', ['checklist_pre', 'checklist_post'])
          .order('event_at', { ascending: false });
        
        if (error) {
          console.error('[useChecklistStatus] Query error:', error);
          return { pre: null, post: null };
        }
        const pre = events?.find((event) => event.event_type === 'checklist_pre');
        const post = events?.find((event) => event.event_type === 'checklist_post');
        return { pre, post };
      } catch (err) {
        console.error('[useChecklistStatus] Fatal error:', err);
        return { pre: null, post: null };
      }
    },
    enabled: !!tripId && !!currentTenant,
  });

  const preCheckedCount = checkedItemCount(data?.pre?.payload);
  const postCheckedCount = checkedItemCount(data?.post?.payload);

  return {
    preCompleted: preCheckedCount === PRE_TRIP_TOTAL,
    postCompleted: postCheckedCount === POST_TRIP_TOTAL,
    preCheckedCount,
    postCheckedCount,
    preTotalCount: PRE_TRIP_TOTAL,
    postTotalCount: POST_TRIP_TOTAL,
    isLoading,
  };
}
