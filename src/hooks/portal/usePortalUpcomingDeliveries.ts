import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
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

export function usePortalUpcomingDeliveries(opts?: { clientId?: string | null; limit?: number }) {
  const { currentTenant } = useTenant();
  const clientId = opts?.clientId ?? null;
  const limit = opts?.limit ?? 8;
  return useQuery({
    queryKey: ['portal_upcoming', currentTenant?.id, clientId, limit],
    queryFn: async (): Promise<UpcomingDelivery[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('get_client_portal_upcoming_deliveries' as any, {
        _tenant_id: currentTenant.id,
        _client_id: clientId,
        _limit: limit,
      });
      if (error) throw error;
      return (data as UpcomingDelivery[]) ?? [];
    },
    enabled: !!currentTenant,
    staleTime: 60_000,
  });
}
