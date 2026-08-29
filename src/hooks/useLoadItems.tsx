import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

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
      const { data, error } = await supabase
        .from('load_items')
        .select('*, orders(order_number, clients(company_name)), fiscal_documents(invoice_number, value, remitter, remitter_cnpj, recipient, recipient_city, recipient_state)')
        .eq('load_id', loadId)
        .order('created_at', { ascending: true });
      if (error) throw error;
      return (data || []) as LoadItem[];
    },
    enabled: !!loadId,
  });
}

export function useCreateLoadItem() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<LoadItem> & Pick<LoadItem, 'load_id'>) => {
      // Vínculo com NF é exclusivamente via RPC oficial (sincroniza fiscal_documents.load_id + auditoria).
      if (values.fiscal_document_id) {
        const { data, error } = await supabase.rpc('assign_fiscal_documents_to_load_v2', {
          _tenant_id: currentTenant!.id,
          _load_id: values.load_id,
          _document_ids: [values.fiscal_document_id],
        });
        if (error) throw error;
        return data;
      }
      const { data, error } = await supabase.rpc('upsert_load_item_v3', {
        p_tenant_id: currentTenant!.id,
        p_load_id: values.load_id,
        p_order_id: values.order_id ?? undefined,
        p_item_description: values.item_description ?? undefined,
        p_quantity: values.quantity ?? undefined,
        p_pallet_count: values.pallet_count ?? undefined,
        p_weight_kg: values.weight_kg ?? undefined,
        p_volume_m3: values.volume_m3 ?? undefined,
        p_status: values.status ?? undefined,
        p_notes: values.notes ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}

export function useUpdateLoadItem() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<LoadItem> & { id: string }) => {
      // Bloqueia mudança de load_id por write direto — use move_load_items_between_loads.
      if ('load_id' in values) {
        throw new Error('Mudança de load_id deve passar por move_load_items_between_loads.');
      }
      // Mudança de fiscal_document_id pelo write direto também é bloqueada — invalida composição.
      if ('fiscal_document_id' in values) {
        throw new Error('Mudança de fiscal_document_id não é permitida por update direto.');
      }
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('upsert_load_item_v3', {
        p_tenant_id: currentTenant.id,
        p_item_id: id,
        p_order_id: values.order_id ?? undefined,
        p_item_description: values.item_description ?? undefined,
        p_quantity: values.quantity ?? undefined,
        p_pallet_count: values.pallet_count ?? undefined,
        p_weight_kg: values.weight_kg ?? undefined,
        p_volume_m3: values.volume_m3 ?? undefined,
        p_status: values.status ?? undefined,
        p_notes: values.notes ?? undefined,
      });
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useDeleteLoadItem() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { data: item, error: fetchErr } = await supabase
        .from('load_items')
        .select('id, load_id, fiscal_document_id')
        .eq('id', id)
        .maybeSingle();
      if (fetchErr) throw fetchErr;
      if (!item) return;
      if (item.fiscal_document_id) {
        const { error } = await supabase.rpc('remove_fiscal_documents_from_load_v2', {
          _tenant_id: currentTenant!.id,
          _load_id: item.load_id,
          _document_ids: [item.fiscal_document_id],
        });
        if (error) throw error;
        return;
      }
      const { error } = await supabase.rpc('delete_load_item_v3', {
        p_tenant_id: currentTenant!.id,
        p_item_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}
