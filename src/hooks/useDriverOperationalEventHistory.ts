import { useInfiniteQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { supabase } from '@/integrations/supabase/client';
import {
  mergeDriverOperationalEventPages,
  parseDriverOperationalEventPage,
  type DriverOperationalEventCursor,
} from '@/lib/driver/driverOperationalEventHistory';

export function useDriverOperationalEventHistory(input: {
  driverId?: string;
  tripId?: string | null;
  enabled?: boolean;
}) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const actorId = user?.id;
  const tripId = input.tripId ?? null;

  return useInfiniteQuery({
    queryKey: ['driver_operational_event_history', tenantId, actorId, input.driverId, tripId],
    enabled: (input.enabled ?? true) && !!tenantId && !!actorId && !!input.driverId,
    retry: false,
    initialPageParam: null as DriverOperationalEventCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await supabase.rpc('list_driver_operational_events_page_v1', {
        _tenant_id: tenantId!,
        _trip_id: tripId ?? undefined,
        _limit: 50,
        _cursor: pageParam,
      }).abortSignal(signal);
      if (error) throw error;
      return parseDriverOperationalEventPage(data, {
        tenantId: tenantId!,
        actorId: actorId!,
        driverId: input.driverId!,
        tripId,
      });
    },
    getNextPageParam: page => page.next_cursor,
    select: data => ({
      ...data,
      items: mergeDriverOperationalEventPages(data.pages),
    }),
  });
}
