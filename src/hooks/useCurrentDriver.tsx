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
      
      // 1. First, look for trips that are explicitly in an active status
      const { data: activeStatusTrips, error: tripsError } = await supabase
        .from('dispatch_trips')
        .select('*, loads(id, load_number, origin, destination, status), vehicles(plate, nickname)')
        .eq('driver_id', driverId)
        .in('status', TRIP_ACTIVE_STATUSES)
        .order('created_at', { ascending: false });

      if (tripsError) throw tripsError;
      if (activeStatusTrips && activeStatusTrips.length > 0) {
        return activeStatusTrips[0];
      }

      // 2. If no trip is explicitly active, look for LOADS assigned to the driver
      // that are in a "ready to act" status, and find their associated trip.
      const { data: transitLoads, error: loadsError } = await supabase
        .from('loads')
        .select('trip_id')
        .eq('driver_id', driverId)
        .in('status', ['in_transit', 'loading', 'ready', 'loaded'])
        .not('trip_id', 'is', null)
        .order('updated_at', { ascending: false })
        .limit(1);

      if (loadsError) throw loadsError;

      if (transitLoads && transitLoads.length > 0 && transitLoads[0].trip_id) {
        const { data: tripFromLoad, error: tripError } = await supabase
          .from('dispatch_trips')
          .select('*, loads(id, load_number, origin, destination, status), vehicles(plate, nickname)')
          .eq('id', transitLoads[0].trip_id)
          .maybeSingle();
        
        if (tripError) throw tripError;
        if (tripFromLoad) return tripFromLoad;
      }

      return null;
    },
    enabled: !!driverId,
  });
}
