import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import {acknowledgeDurableOperatorCommand,prepareDurableOperatorCommand} from '@/lib/operator/durableOperatorCommand';

export const STOCK_CATEGORIES = ['general','tire','oil','filter','mechanical_part','operational','ppe','other'] as const;
export const STOCK_CATEGORY_LABELS: Record<string,string> = {
  general:'Geral',tire:'Pneu', oil:'Óleo', filter:'Filtro', mechanical_part:'Peça Mecânica',
  operational:'Material Operacional', ppe:'EPI', other:'Outro',
};
export const MOVEMENT_TYPES = ['inbound','outbound','reserve','adjustment','consumption'] as const;
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
export type CreateStockMovementInput = Omit<TablesInsert<'stock_movements'>, 'tenant_id' | 'created_by'> & {adjustment_direction?:'increase'|'decrease'|null};

export function useStockItems() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_items', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages((from, to) => supabase
        .from('stock_items').select('*')
        .eq('tenant_id', currentTenant.id).order('name').order('id').range(from, to)) as Promise<StockItem[]>;
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
    onSuccess: () => Promise.all(['stock_items','finance-maintenance-cost-context','finance-maintenance-labor-context','finance-maintenance-direct-part-context','finance-stock-acquisition-context','finance-stock-consumption-context','finance-stock-consumption-preview','finance-stock-cost-inventory','finance-legacy-cost-inventory'].map(key=>qc.invalidateQueries({queryKey:[key]}))),
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
    onSuccess: () => Promise.all(['stock_items','finance-maintenance-cost-context','finance-maintenance-labor-context','finance-maintenance-direct-part-context','finance-stock-acquisition-context','finance-stock-consumption-context','finance-stock-consumption-preview','finance-stock-cost-inventory','finance-legacy-cost-inventory'].map(key=>qc.invalidateQueries({queryKey:[key]}))),
  });
}

export function useStockMovements(itemId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_movements', currentTenant?.id, itemId],
    queryFn: async () => {
      if (!currentTenant) return [];
      const makeQuery=()=>{let q = supabase
        .from('stock_movements').select('*, stock_items(name), employees!stock_movements_employee_id_fkey(name)')
        .eq('tenant_id', currentTenant.id)
        .order('moved_at', { ascending: false }).order('id');
      if (itemId) q = q.eq('stock_item_id', itemId);
      return q;};
      return await fetchAllPostgrestPages((from,to)=>makeQuery().range(from,to)) as StockMovement[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateStockMovement() {
  const { currentTenant } = useTenant();
  const {user}=useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateStockMovementInput) => {
      if(!user)throw new Error('Usuário não autenticado');
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant!.id,actorId:user.id,action:'create_stock_movement',entityId:'new',payload:values});
      const { data, error } = await supabase.rpc('create_stock_movement_v1', {
        _payload: { ...values, tenant_id: currentTenant!.id,request_id:pending.requestId } as unknown as Json,
      });
      if (error) throw error;
      acknowledgeDurableOperatorCommand(pending);
      return data as unknown as StockMovement;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({queryKey:['finance-maintenance-cost-context']});
      qc.invalidateQueries({queryKey:['finance-maintenance-labor-context']});
      qc.invalidateQueries({queryKey:['finance-maintenance-direct-part-context']});
      qc.invalidateQueries({queryKey:['finance-stock-acquisition-context']});
      qc.invalidateQueries({queryKey:['finance-stock-consumption-context']});
      qc.invalidateQueries({queryKey:['finance-stock-consumption-preview']});
      qc.invalidateQueries({queryKey:['finance-stock-cost-inventory']});
      qc.invalidateQueries({queryKey:['finance-legacy-cost-inventory']});
      qc.invalidateQueries({ queryKey: ['stock_items'] });
    },
  });
}
