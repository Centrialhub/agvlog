import { useInfiniteQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import {
  mergeDriverLoadHistoryPages,
  parseDriverLoadHistoryPage,
  type DriverLoadCursor,
} from '@/lib/driver/driverLoadHistory';
import type { LoadStatus } from '@/lib/status/loadStatus';

export function useDriverLoadHistory(input: {
  driverId?: string;
  search: string;
  status: LoadStatus | null;
}) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const tenantId = currentTenant?.id;
  const actorId = user?.id;
  const search = input.search.trim() || null;

  return useInfiniteQuery({
    queryKey: ['driver_load_history', tenantId, actorId, input.driverId, search, input.status],
    enabled: !!tenantId && !!actorId && !!input.driverId,
    retry: false,
    initialPageParam: null as DriverLoadCursor | null,
    queryFn: async ({ pageParam, signal }) => {
      const { data, error } = await supabase.rpc('list_driver_loads_page_v1', {
        _tenant_id: tenantId!,
        _search: search ?? undefined,
        _status: input.status ?? undefined,
        _limit: 50,
        _cursor: pageParam,
      }).abortSignal(signal);
      if (error) throw error;
      return parseDriverLoadHistoryPage(data, {
        tenantId: tenantId!,
        actorId: actorId!,
        driverId: input.driverId!,
        search,
        status: input.status,
      });
    },
    getNextPageParam: page => page.next_cursor,
    select: data => ({
      ...data,
      items: mergeDriverLoadHistoryPages(data.pages),
    }),
  });
}
