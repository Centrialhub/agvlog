import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalSummary {
  in_transit: number;
  delivered: number;
  delayed: number;
  pending_pickup: number;
  pending_pod: number;
  open_occurrences: number;
  deliveries_today: number;
  deliveries_tomorrow: number;
}

export function usePortalSummary(startDate?: string, endDate?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['portal_summary', currentTenant?.id, startDate, endDate],
    queryFn: async (): Promise<PortalSummary> => {
      if (!currentTenant) {
        return { in_transit: 0, delivered: 0, delayed: 0, pending_pickup: 0, pending_pod: 0, open_occurrences: 0, deliveries_today: 0, deliveries_tomorrow: 0 };
      }
      const { data, error } = await supabase.rpc('get_client_portal_summary', {
        _tenant_id: currentTenant.id,
        _start_date: startDate ?? null,
        _end_date: endDate ?? null,
      });
      if (error) throw error;
      return data as unknown as PortalSummary;
    },
    enabled: !!currentTenant,
    staleTime: 60_000,
  });
}
