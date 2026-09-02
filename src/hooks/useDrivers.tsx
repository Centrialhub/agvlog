import { useQuery } from '@tanstack/react-query';
import { useAuth } from './useAuth';
import { useTenant } from './useTenant';
import type { Tables } from '@/integrations/supabase/types';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';

export type OperatorDriver = Tables<'drivers'> & {
  current_vehicle?: Pick<Tables<'vehicles'>, 'id' | 'plate' | 'nickname'> | null;
};

export function useDrivers(options: { includeInactive?: boolean; enabled?: boolean } = {}) {
  const { includeInactive = false, enabled = true } = options;
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['drivers', currentTenant?.id, includeInactive, user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) return [];
      const rows = await readOperatorReferenceCatalog({
        tenantId: currentTenant.id,
        actorId: user.id,
        resource: 'drivers',
        includeInactive,
      });
      return (rows as unknown as OperatorDriver[]).sort((left, right) => (
        left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id)
      ));
    },
    enabled: enabled && !!currentTenant && !!user,
    retry: false,
  });
}
