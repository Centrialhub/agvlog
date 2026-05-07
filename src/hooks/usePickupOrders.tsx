import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const PICKUP_STATUSES = ['pendente', 'vinculada', 'finalizada', 'cancelada'] as const;
export type PickupStatus = typeof PICKUP_STATUSES[number];

export const PICKUP_STATUS_LABELS: Record<PickupStatus, string> = {
  pendente: 'Pendente',
  vinculada: 'Vinculada',
  finalizada: 'Finalizada',
  cancelada: 'Cancelada',
};

export interface PickupOrder {
  id: string;
  tenant_id: string;
  pickup_number: string;
  remitter_client_id: string | null;
  remitter_name: string | null;
  remitter_cnpj: string | null;
  recipient_name: string | null;
  driver_id: string | null;
  driver_name_snapshot: string | null;
  vehicle_id: string | null;
  vehicle_plate_snapshot: string | null;
  pickup_at: string;
  status: PickupStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  linked_docs_count?: number;
}

export function usePickupOrders(filters?: { status?: PickupStatus | 'all'; search?: string }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pickup_orders', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('pickup_orders' as any)
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('pickup_at', { ascending: false });
      if (filters?.status && filters.status !== 'all') q = q.eq('status', filters.status);
      if (filters?.search) {
        const s = filters.search.trim();
        q = q.or(
          `pickup_number.ilike.%${s}%,remitter_name.ilike.%${s}%,driver_name_snapshot.ilike.%${s}%,vehicle_plate_snapshot.ilike.%${s}%`,
        );
      }
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as unknown as PickupOrder[];
    },
    enabled: !!currentTenant,
  });
}

export function usePickupOrderCounts(pickupIds: string[]) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pickup_orders_counts', currentTenant?.id, pickupIds.sort().join(',')],
    queryFn: async () => {
      if (!currentTenant || pickupIds.length === 0) return {} as Record<string, number>;
      const { data, error } = await (supabase as any)
        .from('fiscal_documents')
        .select('pickup_order_id')
        .eq('tenant_id', currentTenant.id)
        .in('pickup_order_id', pickupIds);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((row: any) => {
        const id = row.pickup_order_id;
        if (id) map[id] = (map[id] || 0) + 1;
      });
      return map;
    },
    enabled: !!currentTenant && pickupIds.length > 0,
  });
}

export function useCreatePickupOrder() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<PickupOrder>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      // Get next number
      const { data: nextNum, error: numErr } = await supabase.rpc('peek_next_pickup_number' as any, {
        _tenant_id: currentTenant.id,
      });
      if (numErr) throw numErr;
      const { data, error } = await supabase
        .from('pickup_orders' as any)
        .insert({
          ...values,
          pickup_number: String(nextNum),
          tenant_id: currentTenant.id,
          created_by: user?.id,
        } as any)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PickupOrder;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickup_orders'] }),
  });
}

export function useUpdatePickupOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<PickupOrder> & { id: string }) => {
      const { data, error } = await supabase
        .from('pickup_orders' as any)
        .update(values as any)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data as unknown as PickupOrder;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickup_orders'] }),
  });
}

export function useDeletePickupOrder() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('pickup_orders' as any).delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickup_orders'] }),
  });
}