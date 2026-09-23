import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';
import {acknowledgeDurableOperatorCommand,isDefinitiveOperatorCommandRejection,prepareDurableOperatorCommand,readDurableOperatorCommand} from '@/lib/operator/durableOperatorCommand';
import { dateOnlyUtcRange } from '@/lib/utils/formatDate';

export const STOCK_CATEGORIES = ['general','tire','oil','filter','mechanical_part','operational','ppe','other'] as const;
export const STOCK_CATEGORY_LABELS: Record<string,string> = {
  general:'Geral',tire:'Pneu', oil:'Óleo', filter:'Filtro', mechanical_part:'Peça Mecânica',
  operational:'Material Operacional', ppe:'EPI', other:'Outro',
};
export const MOVEMENT_TYPES = ['inbound','outbound','transfer','return','reserve','adjustment','consumption'] as const;
export const MOVEMENT_TYPE_LABELS: Record<string,string> = {
  inbound:'Entrada', outbound:'Saída', transfer:'Transferência',
  return:'Devolução', reserve:'Reserva', adjustment:'Ajuste', consumption:'Consumo',
};
export const MOVEMENT_REASON_LABELS: Record<string,string> = {purchase:'Compra',maintenance:'Manutenção',incident:'Ocorrência',vehicle_use:'Uso Veículo',adjustment:'Ajuste',return:'Devolução',transfer:'Transferência',other:'Outro'};

export type StockItem = Tables<'stock_items'>;

export type StockMovement = Tables<'stock_movements'> & {
  adjustment_direction?: 'increase'|'decrease'|null;
  unit_snapshot?: string | null;
  stock_items?: { name: string; unit: string } | null;
  employees?: { name: string } | null;
};

export type CreateStockItemInput = Omit<TablesInsert<'stock_items'>, 'tenant_id' | 'created_by'>;
export type UpdateStockItemInput = Omit<TablesUpdate<'stock_items'>, 'updated_at'> & { id: string; expected_updated_at: string };
export type CreateStockMovementInput = Omit<TablesInsert<'stock_movements'>, 'tenant_id' | 'created_by'> & {adjustment_direction?:'increase'|'decrease'|null};

export function useStockItems(options: { enabled?: boolean } = {}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_items', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      return fetchAllPostgrestPages((from, to) => supabase
        .from('stock_items').select('*')
        .eq('tenant_id', currentTenant.id).order('name').order('id').range(from, to)) as Promise<StockItem[]>;
    },
    enabled: !!currentTenant && options.enabled !== false,
  });
}

type StockPage<T>={rows:T[];total:number};
const stockRpc=async(name:string,args:Record<string,unknown>)=>{
  const {data,error}=await (supabase.rpc.bind(supabase) as unknown as (rpcName:string,rpcArgs:Record<string,unknown>)=>PromiseLike<{data:unknown;error:unknown}>)(name,args);
  if(error)throw error;return data as Record<string,unknown>;
};

export function useStockItemsPage(filters:{search:string;category:string;quantity:string},page:number,pageSize=50){
  const {currentTenant}=useTenant();
  return useQuery({queryKey:['stock_items_page',currentTenant?.id,filters,page,pageSize],enabled:!!currentTenant,queryFn:async()=>{
    if(!currentTenant)return {rows:[],total:0} as StockPage<StockItem>;
    const result=await stockRpc('stock_items_page_v1',{_tenant_id:currentTenant.id,_search:filters.search||null,_category:filters.category==='all'?null:filters.category,_availability:filters.quantity==='all'?null:filters.quantity,_limit:pageSize,_offset:(page-1)*pageSize});
    return {rows:(result.rows??[]) as StockItem[],total:Number(result.total??0)};
  }});
}

export function useStockMovementsPage(filters:{search:string;type:string;from:string;to:string},page:number,pageSize=50,enabled=true){
  const {currentTenant}=useTenant();const timeZone=currentTenant?.timezone||'America/Sao_Paulo';
  return useQuery({queryKey:['stock_movements_page',currentTenant?.id,filters,page,pageSize],enabled:!!currentTenant&&enabled,queryFn:async()=>{
    if(!currentTenant)return {rows:[],total:0} as StockPage<StockMovement>;
    const from=filters.from?dateOnlyUtcRange(filters.from,timeZone).from:null;
    const to=filters.to?dateOnlyUtcRange(filters.to,timeZone).toExclusive:null;
    const result=await stockRpc('stock_movements_page_v1',{_tenant_id:currentTenant.id,_search:filters.search||null,_movement_type:filters.type==='all'?null:filters.type,_from:from,_to_exclusive:to,_limit:pageSize,_offset:(page-1)*pageSize});
    return {rows:(result.rows??[]) as StockMovement[],total:Number(result.total??0)};
  }});
}

export function useStockWorkspaceMetrics(){
  const {currentTenant}=useTenant();
  return useQuery({queryKey:['stock_metrics',currentTenant?.id],enabled:!!currentTenant,queryFn:async()=>{
    if(!currentTenant)return {itemCount:0,lowStockCount:0,recentMovementCount:0};
    const result=await stockRpc('stock_workspace_metrics_v1',{_tenant_id:currentTenant.id});
    return {itemCount:Number(result.item_count??0),lowStockCount:Number(result.low_stock_count??0),recentMovementCount:Number(result.recent_movement_count??0)};
  }});
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
    onSuccess: () => Promise.all(['stock_items','stock_items_page','stock_metrics','finance-maintenance-cost-context','finance-maintenance-labor-context','finance-maintenance-direct-part-context','finance-stock-acquisition-context','finance-stock-consumption-context','finance-stock-consumption-preview','finance-stock-cost-inventory','finance-legacy-cost-inventory'].map(key=>qc.invalidateQueries({queryKey:[key]}))),
  });
}

export function useUpdateStockItem() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, expected_updated_at, ...values }: UpdateStockItemInput) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.from('stock_items')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', id).eq('tenant_id', currentTenant.id).eq('updated_at', expected_updated_at).select().maybeSingle();
      if (error) throw error;
      if (!data) throw new Error('Este item foi alterado por outra pessoa. Reabra a edição para não sobrescrever dados mais recentes.');
      return data;
    },
    onSuccess: () => Promise.all(['stock_items','stock_items_page','stock_metrics','finance-maintenance-cost-context','finance-maintenance-labor-context','finance-maintenance-direct-part-context','finance-stock-acquisition-context','finance-stock-consumption-context','finance-stock-consumption-preview','finance-stock-cost-inventory','finance-legacy-cost-inventory'].map(key=>qc.invalidateQueries({queryKey:[key]}))),
  });
}

export function useStockMovements(itemId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['stock_movements', currentTenant?.id, itemId],
    queryFn: async () => {
      if (!currentTenant) return [];
      const makeQuery=()=>{let q = supabase
        .from('stock_movements').select('*, stock_items(name,unit), employees!stock_movements_employee_id_fkey(name)')
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
  const [pendingRevision,setPendingRevision]=useState(0);
  const mutation=useMutation({
    mutationFn: async (values: CreateStockMovementInput) => {
      if(!user)throw new Error('Usuário não autenticado');
      const pending=await prepareDurableOperatorCommand({tenantId:currentTenant!.id,actorId:user.id,action:'create_stock_movement',entityId:'new',payload:values});
      const { data, error } = await supabase.rpc('create_stock_movement_v1', {
        _payload: { ...values, tenant_id: currentTenant!.id,request_id:pending.requestId } as unknown as Json,
      });
      if (error) {
        if(isDefinitiveOperatorCommandRejection(error))acknowledgeDurableOperatorCommand(pending);
        throw error;
      }
      acknowledgeDurableOperatorCommand(pending);
      return data as unknown as StockMovement;
    },
    onError:()=>setPendingRevision(value=>value+1),
    onSuccess: () => {
      setPendingRevision(value=>value+1);
      qc.invalidateQueries({ queryKey: ['stock_movements'] });
      qc.invalidateQueries({ queryKey: ['stock_movements_page'] });
      qc.invalidateQueries({ queryKey: ['stock_metrics'] });
      qc.invalidateQueries({ queryKey: ['stock_items_page'] });
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
  const pendingCommand=currentTenant&&user?readDurableOperatorCommand({tenantId:currentTenant.id,actorId:user.id,action:'create_stock_movement',entityId:'new'}):null;
  void pendingRevision;
  return Object.assign(mutation,{
    pendingCommand,
    recoverPending:async()=>{
      if(!pendingCommand)throw new Error('Nenhuma movimentação pendente para recuperar.');
      return mutation.mutateAsync(pendingCommand.payload as unknown as CreateStockMovementInput);
    },
    discardPending:()=>{
      if(pendingCommand)acknowledgeDurableOperatorCommand(pendingCommand);
      setPendingRevision(value=>value+1);
    },
  });
}
