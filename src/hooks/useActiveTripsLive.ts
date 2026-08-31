import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { ActiveTripLive, TripAlert } from '@/lib/controlTower/types';
import { useAuth } from './useAuth';
import { readTowerTrips, readTowerAlerts } from '@/lib/controlTower/contracts';

export function useActiveTripsLive() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['active-trips-live', currentTenant?.id, user?.id],
    queryFn: async ({ signal }): Promise<ActiveTripLive[]> => {
      if (!currentTenant) return [];
      // A read never launches an untracked write or an external integration.
      const { data, error } = await supabase.rpc('get_active_trips_live', {
        _tenant_id: currentTenant.id,
      }).abortSignal(signal);
      if (error) throw error;
      return readTowerTrips(data, currentTenant.id);
    },
    enabled: !!currentTenant && !!user,
    retry: false,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useOpenTripAlerts() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['open-trip-alerts', currentTenant?.id, user?.id],
    queryFn: async ({ signal }): Promise<TripAlert[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('get_open_trip_alerts', {
        _tenant_id: currentTenant.id,
      }).abortSignal(signal);
      if (error) throw error;
      return readTowerAlerts(data, currentTenant.id);
    },
    enabled: !!currentTenant && !!user,
    retry: false,
    refetchInterval: 10_000,
  });
}
