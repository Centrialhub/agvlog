import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import type { ActiveTripLive, TripAlert } from '@/lib/controlTower/types';

export function useActiveTripsLive() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['active-trips-live', currentTenant?.id],
    queryFn: async (): Promise<ActiveTripLive[]> => {
      if (!currentTenant) return [];
      // Recalcula status em background (best-effort; ignora erro)
      supabase.functions
        .invoke('update-trip-live-status', { body: { tenant_id: currentTenant.id } })
        .catch(() => {});
      const { data, error } = await supabase.rpc('get_active_trips_live' as any, {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return (data as unknown as ActiveTripLive[]) ?? [];
    },
    enabled: !!currentTenant,
    refetchInterval: 10_000,
    staleTime: 5_000,
  });
}

export function useOpenTripAlerts() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['open-trip-alerts', currentTenant?.id],
    queryFn: async (): Promise<TripAlert[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('get_open_trip_alerts' as any, {
        _tenant_id: currentTenant.id,
      });
      if (error) throw error;
      return (data as unknown as TripAlert[]) ?? [];
    },
    enabled: !!currentTenant,
    refetchInterval: 10_000,
  });
}