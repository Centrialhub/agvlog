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
  fiscal_documents?: { invoice_number: string | null } | null;
}

export function useLoadItems(loadId: string | undefined) {
  return useQuery({
    queryKey: ['load_items', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await (supabase as any)
        .from('load_items')
        .select('*, orders(order_number, clients(company_name)), fiscal_documents(invoice_number)')
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
    mutationFn: async (values: Partial<LoadItem>) => {
      const { data, error } = await (supabase as any).from('load_items').insert({
        ...values,
        tenant_id: currentTenant!.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: (_, variables) => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useUpdateLoadItem() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<LoadItem> & { id: string }) => {
      const { data, error } = await (supabase as any).from('load_items').update({
        ...values,
        updated_at: new Date().toISOString(),
      }).eq('id', id).select().single();
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
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).from('load_items').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}
