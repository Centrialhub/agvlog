import { useQuery } from '@tanstack/react-query';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json } from '@/integrations/supabase/types';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';

export interface Vehicle {
  id: string;
  tenant_id: string;
  plate: string;
  nickname: string | null;
  type: string | null;
  uf: string | null;
  active: boolean;
  tags: Json;
  created_at: string;
  max_pallets: number | null;
  max_weight_kg: number | null;
  max_volume_m3: number | null;
  body_type: string | null;
  current_driver_id: string | null;
  renavam: string | null;
}

export function useVehicles() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();

  return useQuery({
    queryKey: ['vehicles', currentTenant?.id, user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) return [];
      const rows = await readOperatorReferenceCatalog({
        tenantId: currentTenant.id,
        actorId: user.id,
        resource: 'vehicles',
      });
      return (rows as unknown as Vehicle[]).sort((left, right) => (
        left.plate.localeCompare(right.plate, 'pt-BR') || left.id.localeCompare(right.id)
      ));
    },
    enabled: !!currentTenant && !!user,
    retry: false,
  });
}
