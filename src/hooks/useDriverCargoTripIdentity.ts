import { useQuery } from '@tanstack/react-query';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { cargoTripIdentityKey, getDriverCargoTripIdentity } from '@/lib/driver/cargoTripIdentity';

export function useDriverCargoTripIdentity(driverId: string | undefined, tripId: string | null) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const scope = { tenantId: currentTenant?.id ?? '', actorId: user?.id ?? '', driverId: driverId ?? '', tripId: tripId ?? '' };
  return useQuery({
    queryKey: cargoTripIdentityKey(scope),
    enabled: !!scope.tenantId && !!scope.actorId && !!scope.driverId && !!scope.tripId,
    retry: false,
    queryFn: ({ signal }) => getDriverCargoTripIdentity(scope, signal),
  });
}
