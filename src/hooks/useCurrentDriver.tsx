import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { TRIP_ACTIVE_STATUSES, TRIP_STATUS_LABELS, LOAD_ACTIVE_STATUSES } from '@/lib/status';

export interface CurrentDriver {
  id: string;
  name: string;
  tenant_id: string;
  user_id?: string;
}

export function useCurrentDriver() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['current_driver', user?.id, currentTenant?.id],
    queryFn: async (): Promise<CurrentDriver | null> => {
      try {
        if (!user || !currentTenant) return null;
        const { data, error } = await (supabase
          .from('drivers')
          .select('id, name, tenant_id, user_id') as any)
          .eq('user_id', user.id)
          .eq('tenant_id', currentTenant.id)
          .eq('active', true)
          .maybeSingle();
        if (error) {
          console.error('[useCurrentDriver] Query error:', error);
          return null;
        }
        return data as CurrentDriver | null;
      } catch (err) {
        console.error('[useCurrentDriver] Fatal error:', err);
        return null;
      }
    },
    enabled: !!user && !!currentTenant,
    retry: 1,
    staleTime: 1000 * 60 * 5, // 5 minutes
  });
}

export function useActiveTrip(driverId: string | undefined) {
  return useQuery({
    queryKey: ['driver_active_trip', driverId],
    queryFn: async () => {
      try {
        if (!driverId) return null;
        
        // 1. First, look for trips linked to this driver in an active status
        // We use the canonical relationship via dispatch_trip_loads if needed,
        // but dispatch_trips itself has driver_id.
        const { data: trips, error: tripsError } = await supabase
          .from('dispatch_trips')
          .select(`
            *,
            vehicle:vehicles(plate, nickname),
            trip_loads:dispatch_trip_loads(
              load:loads(id, load_number, origin, destination, status)
            )
          `)
          .eq('driver_id', driverId)
          .in('status', TRIP_ACTIVE_STATUSES)
          .order('created_at', { ascending: false });

        if (tripsError) {
          console.error('[useActiveTrip] Trips query error:', tripsError);
          return null;
        }

        if (trips && trips.length > 0) {
          // Normalize the structure to match expectations (picking the first load for compatibility)
          const trip = trips[0] as any;
          const firstLoad = trip.trip_loads?.[0]?.load;
          return {
            ...trip,
            vehicles: trip.vehicle, // Compatibility
            loads: firstLoad // Compatibility for single-load UI parts
          };
        }

        return null;
      } catch (err) {
        console.error('[useActiveTrip] Fatal error:', err);
        return null;
      }
    },
    enabled: !!driverId,
    retry: 1,
    staleTime: 1000 * 30, // 30 seconds
  });
}
