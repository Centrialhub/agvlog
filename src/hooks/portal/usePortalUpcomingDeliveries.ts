import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import type { PublicShipmentStatus } from '@/lib/portal/portalStatus';

export interface UpcomingDelivery {
  fiscal_document_id: string;
  invoice_number: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  planned_arrival_at: string | null;
  public_status: PublicShipmentStatus;
  has_open_occurrence: boolean;
  has_pod: boolean;
  load_number: string | null;
  driver_name: string | null;
  vehicle_plate: string | null;
}

export function usePortalUpcomingDeliveries(opts?: { limit?: number }) {
  const { currentTenant } = useTenant();
  const scope = usePortalClientScope();
  const limit = opts?.limit ?? 8;
  return useQuery({
    queryKey: ['portal_upcoming_v3', currentTenant?.id, scope.selectedClientId, limit],
    queryFn: async (): Promise<UpcomingDelivery[]> => {
      if (!currentTenant || !scope.selectedClientId) return [];
      const { data, error } = await (supabase as any).rpc('get_client_portal_upcoming_deliveries_v2', {
        _tenant_id: currentTenant.id,
        _client_id: scope.selectedClientId,
        _limit: limit,
      });
      if (error) throw error;
      return (data as UpcomingDelivery[]) ?? [];
    },
    enabled: !!currentTenant && !!scope.selectedClientId,
    staleTime: 60_000,
  });
}
