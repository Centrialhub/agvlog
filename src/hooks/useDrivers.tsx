import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export interface Driver {
  id: string;
  name: string;
  cpf: string | null;
  phone: string | null;
  active: boolean;
  tenant_id: string;
  current_vehicle_id: string | null;
  driver_type: string;
  created_at: string;
  vehicles?: {
    plate: string;
    nickname: string | null;
  } | null;
}

export interface PaginatedDrivers {
  items: Driver[];
  next_cursor: string | null;
  total_count: number;
}

export const useDrivers = (filters: { search?: string; activeOnly?: boolean } = {}) => {
  const { currentTenant } = useTenant();

  return useQuery<PaginatedDrivers>({
    queryKey: ['drivers', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return { items: [], next_cursor: null, total_count: 0 };

      const { data, error } = await supabase.rpc('list_drivers_v1', {
        p_tenant_id: currentTenant.id,
        p_search: filters.search || null,
        p_active_only: filters.activeOnly ?? false,
        p_limit: 1000
      });

      if (error) throw error;
      
      const result = data as any;
      return {
        items: (result.items || []) as Driver[],
        next_cursor: result.next_cursor || null,
        total_count: Number(result.total_count) || 0
      };
    },
    enabled: !!currentTenant
  });
};

export const useDriversArray = (filters: { search?: string; activeOnly?: boolean } = {}) => {
  const q = useDrivers(filters);
  const items = (q.data as any)?.items || [];
  return { ...q, data: items } as any;
};

export const useCreateDriver = () => {
  const { currentTenant } = useTenant();
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (payload: Partial<Driver>) => {
      if (!currentTenant) throw new Error('Tenant not found');
      
      // Remove virtual properties before insert
      const { vehicles, ...rest } = payload;
      
      const { data, error } = await supabase
        .from('drivers')
        .insert({ 
          ...rest, 
          tenant_id: currentTenant.id,
          name: rest.name || '',
          driver_type: rest.driver_type || 'fixed'
        } as any)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    }
  });
};

export const useUpdateDriver = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async ({ id, ...payload }: Partial<Driver> & { id: string }) => {
      // Remove virtual properties
      const { vehicles, ...rest } = payload;
      
      const { data, error } = await supabase
        .from('drivers')
        .update(rest as any)
        .eq('id', id)
        .select()
        .single();

      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    }
  });
};

export const useDeleteDriver = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase
        .from('drivers')
        .delete()
        .eq('id', id);

      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['drivers'] });
    }
  });
};
