import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

export interface PortalReportsSummary {
  period_start: string;
  period_end: string;
  deliveries_total: number;
  deliveries_by_status: Array<{ status: string; total: number }>;
  deliveries_delayed: number;
  pending_pods: number;
  occurrences_by_type: Array<{ event_type: string; total: number }>;
  pickups_by_status: Array<{ status: string; total: number }>;
  top_cities: Array<{ city: string; state: string; total: number }>;
  avg_delivery_days: number;
}

export function usePortalReports(range: { start?: string; end?: string }) {
  const { currentTenant } = useTenant();
  const { selectedClientId } = usePortalClientScope();
  return useQuery({
    queryKey: ['portal_reports_summary', currentTenant?.id, selectedClientId, range.start, range.end],
    queryFn: async (): Promise<PortalReportsSummary | null> => {
      if (!currentTenant) return null;
      const { data, error } = await (supabase as any).rpc('get_client_portal_reports_summary_v2', {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId,
        _start_date: range.start || null,
        _end_date: range.end || null,
      });
      if (error) throw error;
      return (data as PortalReportsSummary) || null;
    },
    enabled: !!currentTenant,
  });
}