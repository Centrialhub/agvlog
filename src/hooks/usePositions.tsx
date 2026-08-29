import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { Tables } from '@/integrations/supabase/types';

export type PositionLast = Tables<'positions_last'>;
export type PositionRaw = Tables<'positions_raw'>;

export function useFleetPositions() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['positions_last', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('positions_last')
        .select('*')
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
      return (data || []) as PositionLast[];
    },
    enabled: !!currentTenant,
    refetchInterval: 30000, // 30s auto-refresh
  });
}

export function useVehicleHistory(vehicleId: string | null, startDate?: string, endDate?: string) {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['positions_raw', currentTenant?.id, vehicleId, startDate, endDate],
    queryFn: async () => {
      if (!currentTenant || !vehicleId) return [];
      let query = supabase
        .from('positions_raw')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('vehicle_id', vehicleId)
        .order('captured_at', { ascending: true });

      if (startDate) query = query.gte('captured_at', startDate);
      if (endDate) query = query.lte('captured_at', endDate);

      const { data, error } = await query.limit(5000);
      if (error) throw error;
      return (data || []) as PositionRaw[];
    },
    enabled: !!currentTenant && !!vehicleId,
  });
}
