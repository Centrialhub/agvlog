import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalAccess {
  client_id: string;
  access_type: 'full' | 'remitter' | 'recipient' | 'payer' | 'viewer' | 'financial' | 'documents_only';
  can_view_financial: boolean;
  can_download_documents: boolean;
  can_open_occurrences: boolean;
  can_request_pickup: boolean;
  can_view_vehicle_live: boolean;
  can_view_driver_contact: boolean;
}

export function useClientPortalAccess() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['client_portal_access', currentTenant?.id],
    queryFn: async (): Promise<PortalAccess[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('get_user_client_access', {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return (data as PortalAccess[]) || [];
    },
    enabled: !!currentTenant,
    staleTime: 1000 * 60 * 5,
  });
}

export function hasAnyPermission(access: PortalAccess[], perm: keyof Omit<PortalAccess, 'client_id' | 'access_type'>) {
  return access.some((a) => a[perm]);
}
