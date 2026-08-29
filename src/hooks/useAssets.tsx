import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

export const ASSET_CATEGORIES = ['vehicle','implement','equipment','tracker','phone_radio','tool','ppe','other'] as const;
export const ASSET_STATUSES = ['available','in_use','maintenance','decommissioned','lost'] as const;
export const ASSET_CATEGORY_LABELS: Record<string,string> = {
  vehicle:'Veículo', implement:'Implemento', equipment:'Equipamento', tracker:'Rastreador',
  phone_radio:'Celular/Rádio', tool:'Ferramenta', ppe:'EPI', other:'Outro',
};
export const ASSET_STATUS_LABELS: Record<string,string> = {
  available:'Disponível', in_use:'Em Uso', maintenance:'Manutenção', decommissioned:'Baixado', lost:'Extraviado',
};

export type Asset = Tables<'assets'> & {
  employees?: { name: string } | null;
};

export type AssetMovement = Tables<'asset_movements'>;

export type CreateAssetInput = Omit<TablesInsert<'assets'>, 'tenant_id' | 'created_by'>;
export type UpdateAssetInput = TablesUpdate<'assets'> & { id: string };
export type CreateAssetMovementInput = Omit<TablesInsert<'asset_movements'>, 'tenant_id' | 'created_by'>;

export function useAssets() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['assets', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('assets').select('*, employees(name)')
        .eq('tenant_id', currentTenant.id)
        .order('name');
      if (error) throw error;
      return (data || []) as Asset[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateAsset() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateAssetInput) => {
      const { data, error } = await supabase.from('assets').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useUpdateAsset() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: UpdateAssetInput) => {
      const { data, error } = await supabase.from('assets')
        .update({ ...values, updated_at: new Date().toISOString() })
        .eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['assets'] }),
  });
}

export function useAssetMovements(assetId?: string) {
  return useQuery({
    queryKey: ['asset_movements', assetId],
    queryFn: async () => {
      if (!assetId) return [];
      const { data, error } = await supabase
        .from('asset_movements').select('*')
        .eq('asset_id', assetId).order('moved_at', { ascending: false });
      if (error) throw error;
      return (data || []) as AssetMovement[];
    },
    enabled: !!assetId,
  });
}

export function useCreateAssetMovement() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: CreateAssetMovementInput) => {
      const { data, error } = await supabase.from('asset_movements').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset_movements'] }),
  });
}
