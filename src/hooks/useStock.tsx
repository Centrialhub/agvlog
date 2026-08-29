import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

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

export type StockItem = Tables<'stock_items'>;

export type StockMovement = Tables<'stock_movements'> & {
  stock_items?: { name: string } | null;
  employees?: { name: string } | null;
};

export type CreateStockItemInput = Omit<TablesInsert<'stock_items'>, 'tenant_id' | 'created_by'>;
export type UpdateStockItemInput = TablesUpdate<'stock_items'> & { id: string };
export type CreateStockMovementInput = Omit<TablesInsert<'stock_movements'>, 'tenant_id' | 'created_by'>;

export function useStockItems() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_items', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
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
    mutationFn: async (values: CreateStockItemInput) => {
      const { data, error } = await supabase.from('stock_items').insert({
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
    mutationFn: async ({ id, ...values }: UpdateStockItemInput) => {
      const { data, error } = await supabase.from('stock_items')
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
      let q = supabase
        .from('stock_movements').select('*, stock_items(name), employees!stock_movements_employee_id_fkey(name)')
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
    mutationFn: async (values: CreateStockMovementInput) => {
      const { data, error } = await supabase.from('stock_movements').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      // Update stock_item current_quantity
      if (values.stock_item_id && values.quantity) {
        const sign = ['inbound','return'].includes(values.movement_type || '') ? 1 : -1;
        const { data: item } = await supabase.from('stock_items')
          .select('current_quantity').eq('id', values.stock_item_id).single();
        if (item) {
          await supabase.from('stock_items').update({
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
