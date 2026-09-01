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
      const { data, error } = await supabase
        .from('positions_last')
        .select('lat, lng, captured_at')
        .eq('tenant_id', currentTenant.id)
        .eq('vehicle_id', vehicleId)
        .maybeSingle();
      if (error) throw error;
      return isFreshPositionObservation(data) ? data : null;
    },
    enabled: !!currentTenant && !!vehicleId,
    staleTime: 15_000,
    refetchInterval: 30_000,
    refetchIntervalInBackground: false,
    retry: false,
  });
}
