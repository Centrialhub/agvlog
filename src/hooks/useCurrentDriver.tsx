import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import { TRIP_ACTIVE_STATUSES } from '@/lib/status';

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
      const { data, error } = await supabase
        .from('dispatch_trips')
        .select('*, loads(load_number, origin, destination, status), vehicles(plate, nickname)')
        .eq('driver_id', driverId)
        .in('status', TRIP_ACTIVE_STATUSES as unknown as string[])
        .order('created_at', { ascending: false })
        .limit(1)
        .maybeSingle();
      if (error) throw error;
      return data;
    },
    enabled: !!driverId,
  });
}
