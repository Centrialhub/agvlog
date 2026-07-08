import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalTrackingNextStop {
  id: string;
  sequence: number;
  destination: string | null;
  city: string | null;
  state: string | null;
  planned_arrival_at: string | null;
}

export interface PortalTrackingItem {
  load_id: string;
  load_number: string;
  status: string;
  updated_at: string;
  client_id: string;
  trip_id: string | null;
  plate: string | null;
  vehicle_nickname: string | null;
  lat: number | null;
  lng: number | null;
  speed: number | null;
  captured_at: string | null;
  driver_name: string | null;
  driver_phone: string | null;
  actual_start_at: string | null;
  planned_end_at: string | null;
  next_stop: PortalTrackingNextStop | null;
  can_view_vehicle_live: boolean;
  can_view_driver_contact: boolean;
}

export function usePortalTracking() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['portal_tracking', currentTenant?.id],
    queryFn: async (): Promise<PortalTrackingItem[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('get_client_portal_tracking' as any, {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      const payload = (data as any) || {};
      return (payload.items as PortalTrackingItem[]) || [];
    },
    enabled: !!currentTenant,
    refetchInterval: 60_000,
  });
}