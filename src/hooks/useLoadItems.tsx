// guardrail:allow-direct-write
import { useMutation, useQueryClient, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';

export interface LoadItem {
  id: string;
  load_id: string;
  item_description: string;
  quantity: number;
  pallet_count?: number;
  weight_kg?: number;
  volume_m3?: number;
  fiscal_document_id?: string;
}

export function useLoadItems(loadId?: string) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['load_items', loadId],
    queryFn: async () => {
      if (!loadId) return [];
      const { data, error } = await supabase
        .from('load_items')
        .select('*')
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
        const { error } = await supabase.rpc('unlink_document_from_load_v2', {
          p_tenant_id: currentTenant!.id,
          p_fiscal_document_id: fiscalDocumentId
        } as any);
        if (error) throw error;
      } else {
        // linter:allow-direct-write load_items RPC-not-yet-typed 2026-08-30
        const { error } = await (supabase as any).rpc('delete_load_item_v1', {
          p_tenant_id: currentTenant!.id,
          p_item_id: id
        });
        if (error) throw error;
      }
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['load_items'] });
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['fiscal_documents'] });
    },
  });
}
