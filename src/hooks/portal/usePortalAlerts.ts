import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export type PortalAlertType =
  | 'delay'
  | 'occurrence'
  | 'client_action'
  | 'pod_pending'
  | 'pod_rejected'
  | 'pickup_pending';

export type PortalAlertSeverity = 'info' | 'warning' | 'danger';

export interface PortalAlert {
  related_id: string;
  type: PortalAlertType;
  severity: PortalAlertSeverity;
  title: string;
  description: string | null;
  related_type: string;
  fiscal_document: string | null;
  pickup_order: string | null;
  operational_event: string | null;
  proof_of_delivery: string | null;
  created_at: string;
  action_label: string;
  action_url: string;
}

export function usePortalAlerts(opts?: { clientId?: string | null; limit?: number }) {
  const { currentTenant } = useTenant();
  const clientId = opts?.clientId ?? null;
  const limit = opts?.limit ?? 10;
  return useQuery({
    queryKey: ['portal_alerts', currentTenant?.id, clientId, limit],
    queryFn: async (): Promise<PortalAlert[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('get_client_portal_alerts' as any, {
        _tenant_id: currentTenant.id,
        _client_id: clientId,
        _limit: limit,
      });
      if (error) throw error;
      return (data as PortalAlert[]) ?? [];
    },
    enabled: !!currentTenant,
    staleTime: 60_000,
  });
}
