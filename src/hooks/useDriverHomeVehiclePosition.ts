import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { isFreshPositionObservation } from '@/lib/positionTelemetry';
import { useTenant } from '@/hooks/useTenant';

export function useDriverHomeVehiclePosition(vehicleId?: string | null) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['driver_home_vehicle_pos', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return null;
      const { data, error } = await supabase.rpc('get_workspace_vehicle_position_v1', {
        _tenant_id: currentTenant.id,
        _vehicle_id: vehicleId,
      });
      if (error) throw error;
      const observation = data?.[0] ?? null;
      return isFreshPositionObservation(observation) ? observation : null;
    },
    enabled: !!currentTenant && !!vehicleId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
