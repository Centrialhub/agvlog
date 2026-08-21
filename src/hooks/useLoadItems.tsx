// guardrail:allow-direct-write
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { isFeatureEnabled } from '@/lib/featureFlags';

export const ITEM_STATUSES = ['picking', 'ready_for_load', 'in_loading', 'loaded', 'in_transit', 'delivered', 'divergence', 'return'] as const;

export const ITEM_STATUS_LABELS: Record<string, string> = {
  picking: 'Separação',
  ready_for_load: 'Pronto p/ Carga',
  in_loading: 'Carregando',
  loaded: 'Carregado',
  in_transit: 'Em Trânsito',
  delivered: 'Entregue',
  divergence: 'Divergência',
  return: 'Devolução'
};

export interface LoadItem {
  id: string;
  load_id: string;
  item_description: string;
  quantity: number;
  pallet_count: number;
  weight_kg?: number;
  volume_m3?: number;
  fiscal_document_id?: string;
  status?: string;
  orders?: {
    order_number?: string;
    clients?: {
      company_name?: string;
    };
  };
  fiscal_documents?: {
    recipient?: string;
    recipient_city?: string;
    recipient_state?: string;
    remitter?: string;
    value?: number;
    invoice_number?: string;
  };
}

export function useLoadItems(loadId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load_items', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await supabase
        .from('load_items')
        .select('*, orders(order_number, clients(company_name)), fiscal_documents(recipient, recipient_city, recipient_state, remitter, value, invoice_number)')
        .eq('load_id', loadId)
        .eq('tenant_id', currentTenant!.id);
      if (error) throw error;
      return data as LoadItem[];
    },
    enabled: !!loadId && !!currentTenant,
  });
}

export function useCreateLoadItem() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (p: Omit<LoadItem, 'id'>) => {
      if (isFeatureEnabled('LOGISTICS_CONSOLIDATION_V2')) {
        const { error } = await supabase.rpc('upsert_load_item_v1', {
          p_tenant_id: currentTenant!.id,
          p_load_id: p.load_id,
          p_item_description: p.item_description,
          p_quantity: p.quantity,
          p_pallet_count: p.pallet_count || 0,
          p_weight_kg: p.weight_kg || 0,
          p_volume_m3: p.volume_m3 || 0,
          p_fiscal_document_id: p.fiscal_document_id
        });
        if (error) throw error;
      } else {
        if (p.fiscal_document_id) {
          const { error } = await supabase.rpc('assign_fiscal_documents_to_load', {
            _tenant_id: currentTenant!.id,
            _load_id: p.load_id,
            _document_ids: [p.fiscal_document_id]
          });
          if (error) throw error;
        } else {
          // Fallback to direct insert if no doc (manual items)
          const { error } = await supabase.from('load_items').insert({ // linter:allow-direct-write load_items [V1 fallback for manual items] [2026-12-31]
            tenant_id: currentTenant!.id,
            load_id: p.load_id,
            item_description: p.item_description,
            quantity: p.quantity,
            pallet_count: p.pallet_count || 0,
            weight_kg: p.weight_kg || 0,
            volume_m3: p.volume_m3 || 0
          });
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useUpdateLoadItem() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (p: Partial<LoadItem> & { id: string; load_id: string }) => {
      const { data: item } = await supabase
        .from('load_items')
        .select('*')
        .eq('id', p.id)
        .single();
      
      if (isFeatureEnabled('LOGISTICS_CONSOLIDATION_V2')) {
        const { error } = await supabase.rpc('upsert_load_item_v1', {
          p_tenant_id: currentTenant!.id,
          p_load_id: p.load_id,
          p_item_id: p.id,
          p_item_description: p.item_description ?? item?.item_description,
          p_quantity: p.quantity ?? item?.quantity,
          p_pallet_count: p.pallet_count ?? item?.pallet_count,
          p_weight_kg: p.weight_kg ?? item?.weight_kg,
          p_volume_m3: p.volume_m3 ?? item?.volume_m3,
          p_fiscal_document_id: p.fiscal_document_id ?? item?.fiscal_document_id
        });
        if (error) throw error;
      } else {
        // Direct update for canonical fallback
        const { error } = await supabase
          .from('load_items')
          .update({
            item_description: p.item_description ?? item?.item_description,
            quantity: p.quantity ?? item?.quantity,
            pallet_count: p.pallet_count ?? item?.pallet_count,
            weight_kg: p.weight_kg ?? item?.weight_kg,
            volume_m3: p.volume_m3 ?? item?.volume_m3,
            fiscal_document_id: p.fiscal_document_id ?? item?.fiscal_document_id
          })
          .eq('id', p.id)
          .eq('tenant_id', currentTenant!.id);
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useDeleteLoadItem() {
  const qc = useQueryClient();
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async ({ id, fiscalDocumentId }: { id: string; fiscalDocumentId?: string }) => {
      if (fiscalDocumentId) {
        if (isFeatureEnabled('LOGISTICS_CONSOLIDATION_V2')) {
          const { error } = await (supabase as any).rpc('unlink_fiscal_documents_from_load_v1', {
            _tenant_id: currentTenant!.id,
            _load_id: null as any,
            _document_ids: [fiscalDocumentId]
          });
          if (error) throw error;
        } else {
          const { error } = await supabase.rpc('remove_fiscal_documents_from_load', {
            _tenant_id: currentTenant!.id,
            _load_id: null as any,
            _document_ids: [fiscalDocumentId]
          });
          if (error) throw error;
        }
      } else {
        if (isFeatureEnabled('LOGISTICS_CONSOLIDATION_V2')) {
          const { error } = await (supabase as any).rpc('delete_load_item_v1', {
            p_tenant_id: currentTenant!.id,
            p_item_id: id
          });
          if (error) throw error;
        } else {
          // Direct delete for canonical manual items
          const { error } = await supabase
            .from('load_items')
            .delete()
            .eq('id', id)
            .eq('tenant_id', currentTenant!.id);
          if (error) throw error;
        }
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}
