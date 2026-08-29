import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { TRIP_ACTIVE_STATUSES, LOAD_ACTIVE_STATUSES } from '@/lib/status';
import { DRIVER_TRIP_SELECT, normalizeDriverTrip } from '@/lib/driverTrip';

export interface CurrentDriver {
  id: string;
  name: string;
  tenant_id: string;
  active: boolean;
}

export function useCurrentDriver() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['current_driver', user?.id, currentTenant?.id],
    queryFn: async (): Promise<CurrentDriver | null> => {
      if (!user || !currentTenant) return null;
      const { data: driverId, error: identityError } = await supabase.rpc('current_driver_id', {
        _tenant_id: currentTenant.id,
      });
      if (identityError) throw identityError;
      if (!driverId) return null;

      const { data, error } = await supabase
        .from('drivers')
        .select('id, name, tenant_id, active')
        .eq('id', driverId)
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .single();
      if (error) throw error;
      return data as CurrentDriver;
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
      if (!driverId) return null;
        
        // 1. First, look for trips that are explicitly in an active status
        const { data: activeStatusTrips, error: tripsError } = await supabase
          .from('dispatch_trips')
          .select(DRIVER_TRIP_SELECT)
          .eq('driver_id', driverId)
          .in('status', TRIP_ACTIVE_STATUSES)
          .order('created_at', { ascending: false });

        if (tripsError) throw tripsError;

        if (activeStatusTrips && activeStatusTrips.length > 0) {
          return normalizeDriverTrip(activeStatusTrips[0]);
        }

        // 2. If no trip is explicitly active, look for LOADS assigned to the driver
        // and resolve the trip exclusively through the canonical junction.
        const { data: transitLoads, error: loadsError } = await supabase
          .from('loads')
          .select('id')
          .eq('driver_id', driverId)
          .in('status', LOAD_ACTIVE_STATUSES)
          .order('updated_at', { ascending: false })
          .limit(20);

        if (loadsError) throw loadsError;

        if (transitLoads && transitLoads.length > 0) {
          const { data: canonicalLink, error: linkError } = await supabase
            .from('dispatch_trip_loads')
            .select('dispatch_trip_id')
            .in('load_id', transitLoads.map((load) => load.id))
            .order('created_at', { ascending: false })
            .limit(1)
            .maybeSingle();

          if (linkError) throw linkError;
          if (!canonicalLink?.dispatch_trip_id) return null;

          const { data: tripFromLoad, error: tripError } = await supabase
            .from('dispatch_trips')
            .select(DRIVER_TRIP_SELECT)
            .eq('id', canonicalLink.dispatch_trip_id)
            .maybeSingle();
          
          if (tripError) throw tripError;
          if (tripFromLoad) return normalizeDriverTrip(tripFromLoad);
        }

        return null;
    },
    enabled: !!driverId,
    retry: 1,
    staleTime: 1000 * 30, // 30 seconds
  });
}
