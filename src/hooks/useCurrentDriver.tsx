import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { TRIP_ACTIVE_STATUSES, TRIP_STATUS_LABELS } from '@/lib/status';

export interface CurrentDriver {
  id: string;
  name: string;
  tenant_id: string;
}

export function useCurrentDriver() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['current_driver', user?.id, currentTenant?.id],
    queryFn: async (): Promise<CurrentDriver | null> => {
      if (!user || !currentTenant) return null;
      const { data, error } = await (supabase
        .from('drivers')
        .select('id, name, tenant_id') as any)
        .eq('user_id', user.id)
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .maybeSingle();
      if (error) throw error;
      return data as CurrentDriver | null;
    },
    enabled: !!user && !!currentTenant,
  });
}

export function useActiveTrip(driverId: string | undefined) {
  return useQuery({
    queryKey: ['driver_active_trip', driverId],
    queryFn: async () => {
      if (!driverId) return null;
      
      // Fetch all trips for the driver that are either in active trip status OR have an in_transit load
      // We use a broader query and filter locally to handle the inner join logic effectively
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(id, load_number, origin, destination, status), vehicles(plate, nickname)')
        .eq('driver_id', driverId)
        .order('created_at', { ascending: false })
        .limit(10);
        
      if (error) throw error;
      if (!data) return null;

      // Find the first trip that satisfies either condition
      const activeTrip = data.find(trip => 
        (trip.status && (TRIP_ACTIVE_STATUSES as readonly string[]).includes(trip.status)) ||
        (trip.loads?.status === 'in_transit')
      );

      return activeTrip || null;
    },
    enabled: !!driverId,
  });
}
