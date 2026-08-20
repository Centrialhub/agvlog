import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export interface OperationalRoute {
  id: string;
  tenant_id: string;
  name: string;
  description: string | null;
  classification: string;
  destinations: any[];
  region_name: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface PaginatedOperationalRoutes {
  items: OperationalRoute[];
  next_cursor: string | null;
  total_count: number;
}

export function useOperationalRoutes(filters: { search?: string; includeInactive?: boolean } = {}) {
  const { currentTenant } = useTenant();
  return useQuery<PaginatedOperationalRoutes>({
    queryKey: ['operational_routes', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return { items: [], next_cursor: null, total_count: 0 };
      const { data, error } = await supabase.rpc('list_operational_routes_v1', {
        p_tenant_id: currentTenant.id,
        p_search: filters.search || null,
        p_include_inactive: filters.includeInactive || false,
        p_limit: 1000,
      });
      if (error) throw error;
      const result = data as any;
      return {
        items: (result.items || []) as OperationalRoute[],
        next_cursor: result.next_cursor || null,
        total_count: Number(result.total_count) || 0,
      };
    },
    enabled: !!currentTenant,
  });
}

export function useOperationalRoutesArray(filters: { search?: string; includeInactive?: boolean } = {}) {
  const q = useOperationalRoutes(filters);
  return { ...q, data: q.data?.items ?? [] };
}

export function useCreateOperationalRoute() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<OperationalRoute>) => {
      const { data, error } = await supabase.from('operational_routes').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_routes'] }),
  });
}

export function useUpdateOperationalRoute() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<OperationalRoute> & { id: string }) => {
      const { data, error } = await supabase.from('operational_routes').update({
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_routes'] }),
  });
}

export function useDeleteOperationalRoute() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('operational_routes').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['operational_routes'] }),
  });
}
