import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isFreshPositionObservation } from '@/lib/positionTelemetry';
import { useTenant } from '@/hooks/useTenant';
import { useAuth } from '@/hooks/useAuth';
import { hasValidGeographicCoordinates } from '@/lib/maps/coordinates';

export function useDriverHomeVehiclePosition(vehicleId?: string | null, tripTenantId?: string | null) {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const tenantId = tripTenantId ?? currentTenant?.id;

  return useQuery({
    queryKey: ['driver_home_vehicle_pos', user?.id, tenantId, vehicleId],
    queryFn: async () => {
      if (!user || !tenantId || !vehicleId) return null;
      const { data, error } = await supabase.rpc('get_workspace_vehicle_position_v1', {
        _tenant_id: tenantId,
        _vehicle_id: vehicleId,
      });
      if (error) throw error;
      const observation = data?.[0] ?? null;
      if (!isFreshPositionObservation(observation)) return null;
      const lat = Number(observation.lat);
      const lng = Number(observation.lng);
      return hasValidGeographicCoordinates(lat, lng) ? { ...observation, lat, lng } : null;
    },
    enabled: !!user && !!tenantId && !!vehicleId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
