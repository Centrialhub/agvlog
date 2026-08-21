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

      let q = supabase
        .from('operational_routes')
        .select('*', { count: 'exact' })
        .eq('tenant_id', currentTenant.id)
        .order('name', { ascending: true })
        .limit(1000);

      if (filters.search) {
        q = q.ilike('name', `%${filters.search}%`);
      }

      if (!filters.includeInactive) {
        q = q.eq('active', true);
      }

      const { data, error, count } = await q;
      if (error) throw error;

      return {
        items: (data || []) as OperationalRoute[],
        next_cursor: null,
        total_count: Number(count) || (data || []).length,
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