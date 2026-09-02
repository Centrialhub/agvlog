import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';

export type RouteDestination = string | { name: string };
export type OperationalRoute = Omit<Tables<'operational_routes'>, 'destinations'> & {
  destinations: RouteDestination[];
};

export function useOperationalRoutes(options: { includeInactive?: boolean } = {}) {
  const { includeInactive = false } = options;
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['operational_routes', currentTenant?.id, includeInactive, user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) return [];
      const rows = await readOperatorReferenceCatalog({
        tenantId: currentTenant.id,
        actorId: user.id,
        resource: 'operational_routes',
        includeInactive,
      });
      return (rows as unknown as OperationalRoute[]).sort((left, right) => (
        left.name.localeCompare(right.name, 'pt-BR') || left.id.localeCompare(right.id)
      ));
    },
    enabled: !!currentTenant && !!user,
    retry: false,
  });
}

export function useCreateOperationalRoute() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<OperationalRoute> & Pick<OperationalRoute, 'name'>) => {
      const payload: TablesInsert<'operational_routes'> = {
        ...values,
        name: values.name,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      };
      const { data, error } = await supabase.from('operational_routes').insert(payload).select().single();
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
      const payload: TablesUpdate<'operational_routes'> = {
        ...values,
        updated_by: user?.id,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('operational_routes').update(payload).eq('id', id).select().single();
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
