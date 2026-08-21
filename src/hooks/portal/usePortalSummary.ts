import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalSummary {
  in_transit: number;
  delivered: number;
  delayed: number;
  pending_pickup: number;
  scheduled_pickups: number;
  pending_pod: number;
  open_occurrences: number;
  client_action_required: number;
  deliveries_today: number;
  deliveries_tomorrow: number;
  documents_last_7_days: number;
}

export function usePortalSummary(opts?: { clientId?: string | null; startDate?: string; endDate?: string }) {
  const { currentTenant } = useTenant();
  const clientId = opts?.clientId ?? null;
  const startDate = opts?.startDate;
  const endDate = opts?.endDate;
  return useQuery({
    queryKey: ['portal_summary_v2', currentTenant?.id, clientId, startDate, endDate],
    queryFn: async (): Promise<PortalSummary> => {
      const empty: PortalSummary = {
        in_transit: 0, delivered: 0, delayed: 0,
        pending_pickup: 0, scheduled_pickups: 0,
        pending_pod: 0, open_occurrences: 0, client_action_required: 0,
        deliveries_today: 0, deliveries_tomorrow: 0, documents_last_7_days: 0,
      };
      if (!currentTenant) {
        return empty;
      }
      const { data, error } = await supabase.rpc('get_client_portal_summary_v2' as any, {
        _tenant_id: currentTenant.id,
        _client_id: clientId,
        _start_date: startDate ?? null,
        _end_date: endDate ?? null,
      });
      if (error) throw error;
      return { ...empty, ...(data as unknown as PortalSummary) };
    },
    enabled: !!currentTenant,
    staleTime: 60_000,
  });
}
