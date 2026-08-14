import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export interface Vehicle {
  id: string;
  tenant_id: string;
  plate: string;
  nickname: string | null;
  type: string | null;
  uf: string | null;
  active: boolean;
  tags: any;
  created_at: string;
}

export function useVehicles() {
  const { currentTenant } = useTenant();

  return useQuery({
    queryKey: ['vehicles', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('vehicles')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .eq('active', true)
        .order('plate');
      if (error) throw error;
      return (data || []) as Vehicle[];
    },
    enabled: !!currentTenant,
  });
}
