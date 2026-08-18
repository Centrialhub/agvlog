import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';

const PRE_TRIP_TOTAL = 8;
const POST_TRIP_TOTAL = 5;

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
  const { data, isLoading } = useQuery({
    queryKey: ['checklist_status', tripId],
    queryFn: async () => {
      try {
        if (!tripId) return { pre: null, post: null };
        const { data: events, error } = await supabase
          .from('dispatch_events')
          .select('event_type, payload')
          .eq('dispatch_trip_id', tripId)
          .in('event_type', ['checklist_pre', 'checklist_post'])
          .order('event_at', { ascending: false });
        
        if (error) {
          console.error('[useChecklistStatus] Query error:', error);
          return { pre: null, post: null };
        }
        const pre = events?.find((e: any) => e.event_type === 'checklist_pre');
        const post = events?.find((e: any) => e.event_type === 'checklist_post');
        return { pre, post };
      } catch (err) {
        console.error('[useChecklistStatus] Fatal error:', err);
        return { pre: null, post: null };
      }
    },
    enabled: !!tripId,
  });

  const prePayload = (data?.pre as any)?.payload;
  const postPayload = (data?.post as any)?.payload;
  const preCheckedCount = prePayload?.checked_items?.length || 0;
  const postCheckedCount = postPayload?.checked_items?.length || 0;

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
