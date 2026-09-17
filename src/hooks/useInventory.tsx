import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { TablesInsert } from '@/integrations/supabase/types';

export const INVENTORY_PAGE_SIZE = 50;

export const ALL_MOVEMENT_TYPES = ['inbound', 'outbound', 'transfer', 'adjustment'] as const;
export type MovementType = typeof ALL_MOVEMENT_TYPES[number];
export const MOVEMENT_TYPES = ['inbound', 'outbound', 'adjustment'] as const;

export const MOVEMENT_TYPE_LABELS: Record<MovementType, string> = {
  inbound: 'Entrada',
  outbound: 'Saída',
  transfer: 'Transferência',
  adjustment: 'Ajuste',
};

export interface InventoryLocation {
  id: string;
  tenant_id: string;
  name: string;
  code: string | null;
  description: string | null;
  active: boolean;
}

export interface InventoryMovement {
  id: string;
  tenant_id: string;
  location_id: string | null;
  movement_type: MovementType;
  client_id: string | null;
  item_description: string;
  quantity: number;
  pallet_count: number;
  weight_kg: number | null;
  volume_m3: number | null;
  fiscal_document_id: string | null;
  adjustment_direction?: 'increase' | 'decrease' | null;
  notes: string | null;
  moved_at: string;
  created_at: string;
  clients?: { company_name: string } | null;
  inventory_locations?: { name: string } | null;
}

export interface InventoryBalance {
  id: string;
  tenant_id: string;
  location_id: string | null;
  client_id: string | null;
  item_description: string;
  quantity: number;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  first_inbound_at: string | null;
  last_movement_at: string | null;
  updated_at: string;
  clients?: { company_name: string } | null;
  inventory_locations?: { name: string } | null;
}

export function useInventoryLocations() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['inventory_locations', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('inventory_locations')
        .select('*')
        .eq('tenant_id', currentTenant.id)
        .order('name');
      if (error) throw error;
      return (data || []) as InventoryLocation[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateLocation() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<InventoryLocation>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const payload = {
        ...values,
        tenant_id: currentTenant.id,
      } as TablesInsert<'inventory_locations'>;
      const { data, error } = await supabase.from('inventory_locations').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['inventory_locations'] }),
  });
}

interface InventoryPageFilters {search?:string;client?:string;location?:string}
interface InventoryMovementPageFilters extends InventoryPageFilters {type?:string;from?:string;to?:string}
export interface InventoryPage<T> {rows:T[];total:number}

export function useInventoryMovements(filters:InventoryMovementPageFilters={},page=1) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['inventory_movements', currentTenant?.id,filters,page],
    queryFn: async ():Promise<InventoryPage<InventoryMovement>> => {
      if (!currentTenant) return {rows:[],total:0};
      let query=supabase.from('inventory_movements')
        .select('*, clients(company_name), inventory_locations(name)',{count:'exact'})
        .eq('tenant_id',currentTenant.id);
      if(filters.search?.trim())query=query.ilike('item_description',`%${filters.search.trim()}%`);
      if(filters.client&&filters.client!=='all')query=query.eq('client_id',filters.client);
      if(filters.location&&filters.location!=='all')query=query.eq('location_id',filters.location);
      if(filters.type&&filters.type!=='all')query=query.eq('movement_type',filters.type);
      if(filters.from)query=query.gte('moved_at',`${filters.from}T00:00:00`);
      if(filters.to)query=query.lte('moved_at',`${filters.to}T23:59:59.999`);
      const from=(page-1)*INVENTORY_PAGE_SIZE;
      const {data,error,count}=await query.order('moved_at',{ascending:false}).order('id',{ascending:false})
        .range(from,from+INVENTORY_PAGE_SIZE-1);
      if(error)throw error;
      return {rows:(data??[]) as InventoryMovement[],total:count??0};
    },
    enabled: !!currentTenant,
  });
}

export function useCreateMovement() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<InventoryMovement>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { clients: _clients, inventory_locations: _locations, ...recordValues } = values;
      const payload = {
        ...recordValues,
        tenant_id: currentTenant.id,
        created_by: user?.id,
      } as TablesInsert<'inventory_movements'>;
      const { data, error } = await supabase.from('inventory_movements').insert(payload).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inventory_movements'] });
      qc.invalidateQueries({ queryKey: ['inventory_balances'] });
      qc.invalidateQueries({ queryKey: ['inventory_summary'] });
    },
  });
}

export function useInventoryBalances(filters:InventoryPageFilters={},page=1,aging=false) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['inventory_balances', currentTenant?.id,filters,page,aging],
    queryFn: async ():Promise<InventoryPage<InventoryBalance>> => {
      if (!currentTenant) return {rows:[],total:0};
      let query=supabase
        .from('inventory_balances')
        .select('*, clients(company_name), inventory_locations(name)',{count:'exact'})
        .eq('tenant_id',currentTenant.id);
      if(filters.search?.trim())query=query.ilike('item_description',`%${filters.search.trim()}%`);
      if(filters.client&&filters.client!=='all')query=query.eq('client_id',filters.client);
      if(filters.location&&filters.location!=='all')query=query.eq('location_id',filters.location);
      if(aging)query=query.gt('quantity',0).lt('first_inbound_at',new Date(Date.now()-30*86400000).toISOString());
      const from=(page-1)*INVENTORY_PAGE_SIZE;
      const {data,error,count}=await query.order(aging?'first_inbound_at':'item_description',{ascending:true})
        .order('id').range(from,from+INVENTORY_PAGE_SIZE-1);
      if(error)throw error;
      return {rows:(data??[]) as InventoryBalance[],total:count??0};
    },
    enabled: !!currentTenant,
  });
}

export function useInventorySummary(){
  const {currentTenant}=useTenant();
  return useQuery({queryKey:['inventory_summary',currentTenant?.id],enabled:!!currentTenant,queryFn:async()=>{
    if(!currentTenant)return {balanceCount:0,totalPallets:0,stagnantCount:0,stockByClient:[]};
    const {data,error}=await supabase.rpc('get_inventory_summary_v1' as never,{_tenant_id:currentTenant.id} as never);
    if(error)throw error;
    const value=data as unknown as {version:number;tenant_id:string;balance_count:number;total_pallets:number|string;stagnant_count:number;
      stock_by_client:Array<{client_id:string|null;name:string;pallets:number|string}>};
    if(value?.version!==1||value.tenant_id!==currentTenant.id)throw new Error('Resumo de inventário incompatível com a empresa atual.');
    return {balanceCount:value.balance_count,totalPallets:Number(value.total_pallets),stagnantCount:value.stagnant_count,
      stockByClient:(value.stock_by_client??[]).map(group=>({...group,pallets:Number(group.pallets)}))};
  }});
}
