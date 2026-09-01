import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import {
  classifyTelemetryFreshness,
  type TelemetryFreshness,
} from '@/lib/telemetryFreshness';

export interface PortalTrackingNextStop {
  id: string;
  sequence: number;
  destination: string | null;
  city: string | null;
  state: string | null;
  planned_arrival_at: string | null;
}

export interface PortalTrackingDocument {
  fiscal_document_id: string;
  invoice_number: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  public_status: string | null;
  planned_arrival_at: string | null;
  has_pod: boolean;
  has_open_occurrence: boolean;
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
  telemetry_freshness: TelemetryFreshness;
  driver_name: string | null;
  driver_phone: string | null;
  actual_start_at: string | null;
  planned_end_at: string | null;
  next_stop: PortalTrackingNextStop | null;
  documents: PortalTrackingDocument[];
  can_view_vehicle_live: boolean;
  can_view_driver_contact: boolean;
}

export function usePortalTracking() {
  const { currentTenant } = useTenant();
  const scope = usePortalClientScope();
  return useQuery({
    queryKey: ['portal_tracking', currentTenant?.id, scope.selectedClientId ?? null],
    queryFn: async (): Promise<PortalTrackingItem[]> => {
      if (!currentTenant || !scope.selectedClientId) return [];
      const { data, error } = await supabase.rpc('get_client_portal_tracking_v2', {
        _tenant_id: currentTenant.id,
        _client_id: scope.selectedClientId,
      });
      if (error) throw error;
      if (!data || typeof data !== 'object' || Array.isArray(data)) return [];
      const items = data.items;
      if (!Array.isArray(items)) return [];
      return (items as unknown as Omit<PortalTrackingItem, 'telemetry_freshness'>[]).map((item) => {
        const telemetryFreshness = classifyTelemetryFreshness(item.captured_at);
        return {
          ...item,
          speed: telemetryFreshness === 'fresh' && typeof item.speed === 'number' && Number.isFinite(item.speed)
            ? item.speed
            : null,
          telemetry_freshness: telemetryFreshness,
        };
      });
    },
    enabled: !!currentTenant && !!scope.selectedClientId,
    refetchInterval: 60_000,
  });
}
