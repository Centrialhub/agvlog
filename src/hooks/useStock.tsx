import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const STOCK_CATEGORIES = ['tire','oil','filter','mechanical_part','operational','ppe','other'] as const;
export const STOCK_CATEGORY_LABELS: Record<string,string> = {
  tire:'Pneu', oil:'Óleo', filter:'Filtro', mechanical_part:'Peça Mecânica',
  operational:'Material Operacional', ppe:'EPI', other:'Outro',
};
export const MOVEMENT_TYPES = ['inbound','outbound','transfer','reserve','adjustment','consumption'] as const;
export const MOVEMENT_TYPE_LABELS: Record<string,string> = {
  inbound:'Entrada', outbound:'Saída', transfer:'Transferência',
  reserve:'Reserva', adjustment:'Ajuste', consumption:'Consumo',
};

export interface StockItem {
  id: string; tenant_id: string; code: string | null;
  name: string; category: string; unit: string;
  min_quantity: number; max_quantity: number | null;
  current_quantity: number; unit_cost: number;
  location: string | null; branch: string | null;
  supplier: string | null; active: boolean;
  notes: string | null; created_at: string;
}

export interface StockMovement {
  id: string; tenant_id: string; stock_item_id: string;
  movement_type: string; quantity: number;
  unit_cost: number; total_cost: number;
  reason: string; vehicle_id: string | null;
  asset_id: string | null; maintenance_order_id: string | null;
  incident_id: string | null; employee_id: string | null;
  cost_center: string | null;
  from_branch: string | null; to_branch: string | null;
  justification: string | null;
  responsible_employee_id: string | null;
  moved_at: string; created_at: string;
  stock_items?: { name: string } | null;
  employees?: { name: string } | null;
}

export function useStockItems() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_items', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any)
        .from('stock_items').select('*')
        .eq('tenant_id', currentTenant.id).order('name');
      if (error) throw error;
      return (data || []) as StockItem[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateStockItem() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<StockItem>) => {
      const { data, error } = await (supabase as any).from('stock_items').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock_items'] }),
  });
}

export function useUpdateStockItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<StockItem> & { id: string }) => {
      const { data, error } = await (supabase as any).from('stock_items')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['stock_items'] }),
  });
}

export function useStockMovements(itemId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_movements', currentTenant?.id, itemId],
    queryFn: async () => {
      if (!currentTenant) return [];
      let q = (supabase as any)
        .from('stock_movements').select('*, stock_items(name), employees(name)')
        .eq('tenant_id', currentTenant.id)
        .order('moved_at', { ascending: false }).limit(500);
      if (itemId) q = q.eq('stock_item_id', itemId);
      const { data, error } = await q;
      if (error) throw error;
      return (data || []) as StockMovement[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateStockMovement() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<StockMovement>) => {
      const { data, error } = await (supabase as any).from('stock_movements').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      // Update stock_item current_quantity
      if (values.stock_item_id && values.quantity) {
        const sign = ['inbound','return'].includes(values.movement_type || '') ? 1 : -1;
        const { data: item } = await (supabase as any).from('stock_items')
          .select('current_quantity').eq('id', values.stock_item_id).single();
        if (item) {
          await (supabase as any).from('stock_items').update({
            current_quantity: Number(item.current_quantity) + (Number(values.quantity) * sign),
            updated_at: new Date().toISOString(),
          }).eq('id', values.stock_item_id);
        }
      }
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['stock_items'] });
    },
  });
}
