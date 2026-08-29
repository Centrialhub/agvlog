import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const MAINT_TYPES = ['preventive','corrective','predictive','emergency'] as const;
export const MAINT_STATUSES = ['open','waiting_parts','in_progress','waiting_approval','completed','cancelled'] as const;
export const MAINT_TYPE_LABELS: Record<string,string> = {
  preventive:'Preventiva', corrective:'Corretiva', predictive:'Preditiva', emergency:'Emergencial',
};
export const MAINT_STATUS_LABELS: Record<string,string> = {
  open:'Aberta', waiting_parts:'Aguard. Peças', in_progress:'Em Andamento',
  waiting_approval:'Aguard. Aprovação', completed:'Concluída', cancelled:'Cancelada',
};

export type MaintenanceOrder = Tables<'maintenance_orders'> & {
  vehicles?: { plate: string; nickname: string | null } | null;
  assets?: { name: string } | null;
  employees?: { name: string } | null;
};

export type MaintenancePart = Tables<'maintenance_parts'>;
export type CreateMaintenanceOrderInput = Omit<TablesInsert<'maintenance_orders'>, 'tenant_id' | 'created_by' | 'order_number'>;
export type UpdateMaintenanceOrderInput = TablesUpdate<'maintenance_orders'> & { id: string };
export type AddMaintenancePartInput = Omit<TablesInsert<'maintenance_parts'>, 'tenant_id'>;

export function useMaintenanceOrders(vehicleId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['maintenance_orders', currentTenant?.id, vehicleId],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('maintenance_orders')
        .select('*, vehicles(plate, nickname), assets(name), employees(name)')
        .eq('tenant_id', currentTenant.id)
        .order('opened_at', { ascending: false });
      if (vehicleId) q = q.eq('vehicle_id', vehicleId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as MaintenanceOrder[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateMaintenanceOrder() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateMaintenanceOrderInput) => {
      const num = `OS-${Date.now().toString(36).toUpperCase()}`;
      const { data, error } = await supabase.from('maintenance_orders').insert({
        ...values, tenant_id: currentTenant!.id, order_number: num, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance_orders'] }),
  });
}

export function useUpdateMaintenanceOrder() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateMaintenanceOrderInput) => {
      const { data, error } = await supabase.from('maintenance_orders')
        .update({ ...values, updated_by: user?.id, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance_orders'] }),
  });
}

export function useMaintenanceParts(orderId?: string) {
  return useQuery({
    queryKey: ['maintenance_parts', orderId],
    queryFn: async () => {
      if (!orderId) return [];
      const { data, error } = await supabase
        .from('maintenance_parts').select('*').eq('maintenance_order_id', orderId);
      if (error) throw error;
      return (data || []) as MaintenancePart[];
    },
    enabled: !!orderId,
  });
}

export function useAddMaintenancePart() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: AddMaintenancePartInput) => {
      const { data, error } = await supabase.from('maintenance_parts').insert({
        ...values, tenant_id: currentTenant!.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['maintenance_parts'] }),
  });
}
