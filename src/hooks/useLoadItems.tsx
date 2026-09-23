import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useItemPreparationWrites } from './useItemPreparationWrites';
import { PREPARATION_STATUSES, itemPreparationMessage, validateManualItemCreation, type ItemPreparationValues, type ItemPreparationExpected } from '@/lib/loads/itemPreparation';
import { selectLoadItemFiscalDocument } from '@/lib/loads/loadItemRelations';
import { fetchAllPostgrestPages } from '@/lib/supabase/fetchAllPages';

export const ITEM_STATUSES = [
  'pending', 'waiting_conference', 'in_stock', 'picking',
  'ready_for_load', 'in_loading', 'loaded', 'in_transit',
  'delivered', 'divergence', 'return', 'redelivery',
] as const;

export type ItemStatus = typeof ITEM_STATUSES[number];

export const ITEM_STATUS_LABELS: Record<ItemStatus, string> = {
  pending: 'Pendente',
  waiting_conference: 'Aguardando Conferência',
  in_stock: 'Em Estoque',
  picking: 'Separação',
  ready_for_load: 'Pronto p/ Carga',
  in_loading: 'Carregando',
  loaded: 'Carregado',
  in_transit: 'Em Trânsito',
  delivered: 'Entregue',
  divergence: 'Divergência',
  return: 'Devolução',
  redelivery: 'Reentrega',
};

export interface LoadItem {
  id: string;
  tenant_id: string;
  load_id: string;
  order_id: string | null;
  fiscal_document_id: string | null;
  item_description: string;
  quantity: number;
  pallet_count: number;
  weight_kg: number;
  volume_m3: number;
  status: ItemStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
  orders?: { order_number: string; clients?: { company_name: string } | null } | null;
  fiscal_documents?: {
    invoice_number: string | null;
    value: number | null;
    remitter: string | null;
    remitter_cnpj: string | null;
    recipient: string | null;
    recipient_city: string | null;
    recipient_state: string | null;
  } | null;
}

export function useLoadItems(loadId: string | undefined) {
  return useQuery({
    queryKey: ['load_items', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      return await fetchAllPostgrestPages((from, to) => supabase
        .from('load_items')
        .select(`*, orders(order_number, clients(company_name)), ${selectLoadItemFiscalDocument('invoice_number, value, remitter, remitter_cnpj, recipient, recipient_city, recipient_state')}`)
        .eq('load_id', loadId)
        .order('created_at', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to)) as LoadItem[];
    },
    enabled: !!loadId,
  });
}

function preparationValues(values: Partial<LoadItem>): ItemPreparationValues {
  const fields: (keyof ItemPreparationValues)[] = ['order_id','item_description','quantity','pallet_count','weight_kg','volume_m3','status','notes'];
  if(values.status && !(PREPARATION_STATUSES as readonly string[]).includes(values.status))
    throw new Error('Use o fluxo operacional para trânsito, entrega, devolução ou reentrega.');
  return Object.fromEntries(fields.filter(key=>values[key]!=null).map(key=>[key,values[key]])) as ItemPreparationValues;
}

export function useCreateLoadItem() {
  const api=useItemPreparationWrites();
  return {...api,mutateAsync:async(values:Partial<LoadItem>&Pick<LoadItem,'load_id'>)=>{
    if(values.fiscal_document_id)throw new Error('Use a confirmação de inclusão de notas para alterar a composição documental.');
    validateManualItemCreation(preparationValues(values));
    return api.submit({load_id:values.load_id,item_id:null,values:preparationValues(values),expected:null});
  }};
}

export function useUpdateLoadItem() {
  const api=useItemPreparationWrites();
  return {...api,mutateAsync:async({id,loadId,expected,...values}:Partial<LoadItem>&{id:string;loadId:string;expected:ItemPreparationExpected})=>{
    if('load_id' in values||'fiscal_document_id' in values)throw new Error('Use a realocação de notas para alterar a composição documental.');
    return api.submit({load_id:loadId,item_id:id,values:preparationValues(values),expected});
  }};
}

export function useDeleteLoadItem() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, expected }: { id: string; expected: ItemPreparationExpected }) => {
      const { error } = await supabase.rpc('delete_load_item_v4', {
        p_tenant_id: currentTenant!.id,
        p_item_id: id,
        p_expected: expected,
      });
      if (error) throw new Error(itemPreparationMessage(error));
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}

export function loadItemDeleteExpected(item: LoadItem): ItemPreparationExpected {
  return {
    order_id: item.order_id,
    item_description: item.item_description,
    quantity: item.quantity,
    pallet_count: item.pallet_count,
    weight_kg: item.weight_kg,
    volume_m3: item.volume_m3,
    status: item.status,
    notes: item.notes,
    updated_at: item.updated_at,
  } as ItemPreparationExpected;
}
