import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { VEHICLE_SAFE_SELECT } from '@/integrations/supabase/selects';
import { useTenant } from './useTenant';
import type { Json } from '@/integrations/supabase/types';

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

  return useQuery({
    queryKey: ['vehicles', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('vehicles')
        .select(VEHICLE_SAFE_SELECT)
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('plate');
      if (error) throw error;
      return (data || []) as Vehicle[];
    },
    enabled: !!currentTenant,
  });
}
