import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import type { Database } from '@/integrations/supabase/types';
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

type PickupOrderRow = Database['public']['Tables']['pickup_orders']['Row'];
type PickupOrderInsert = Database['public']['Tables']['pickup_orders']['Insert'];
type PickupOrderUpdate = Database['public']['Tables']['pickup_orders']['Update'];

export type PickupOrder = Omit<PickupOrderRow, 'status'> & {
  status: PickupStatus;
  linked_docs_count?: number;
};

export type CreatePickupOrderInput = Omit<
  PickupOrderInsert,
  'tenant_id' | 'pickup_number' | 'created_by'
>;

export type UpdatePickupOrderInput = Omit<
  PickupOrderUpdate,
  'id' | 'tenant_id' | 'created_by'
> & { id: string };

function normalizePickupOrder(row: PickupOrderRow): PickupOrder {
  return { ...row, status: row.status as PickupStatus };
}

export function usePickupOrders(filters?: { status?: PickupStatus | 'all'; search?: string }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pickup_orders', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = supabase
        .from('pickup_orders')
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
      return (data || []).map(normalizePickupOrder);
    },
    enabled: !!currentTenant,
  });
}

export function usePickupOrderCounts(pickupIds: string[]) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['pickup_orders_counts', currentTenant?.id, [...pickupIds].sort().join(',')],
    queryFn: async () => {
      if (!currentTenant || pickupIds.length === 0) return {} as Record<string, number>;
      const { data, error } = await supabase
        .from('fiscal_documents')
        .select('pickup_order_id')
        .eq('tenant_id', currentTenant.id)
        .in('pickup_order_id', pickupIds);
      if (error) throw error;
      const map: Record<string, number> = {};
      (data || []).forEach((row) => {
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
    mutationFn: async (values: CreatePickupOrderInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      // Get next number
      const { data: nextNum, error: numErr } = await supabase.rpc('peek_next_pickup_number', {
        _tenant_id: currentTenant.id,
      });
      if (numErr) throw numErr;
      const payload: PickupOrderInsert = {
        ...values,
        pickup_number: String(nextNum),
        tenant_id: currentTenant.id,
        created_by: user?.id ?? null,
      };
      const { data, error } = await supabase
        .from('pickup_orders')
        .insert(payload)
        .select()
        .single();
      if (error) throw error;
      return normalizePickupOrder(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickup_orders'] }),
  });
}

export function useUpdatePickupOrder() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdatePickupOrderInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase
        .from('pickup_orders')
        .update(values)
        .eq('id', id)
        .eq('tenant_id', currentTenant.id)
        .select()
        .single();
      if (error) throw error;
      return normalizePickupOrder(data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickup_orders'] }),
  });
}

export function useDeletePickupOrder() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase
        .from('pickup_orders')
        .delete()
        .eq('id', id)
        .eq('tenant_id', currentTenant.id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['pickup_orders'] }),
  });
}
