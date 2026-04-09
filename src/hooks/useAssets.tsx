import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const ASSET_CATEGORIES = ['vehicle','implement','equipment','tracker','phone_radio','tool','ppe','other'] as const;
export const ASSET_STATUSES = ['available','in_use','maintenance','decommissioned','lost'] as const;
export const ASSET_CATEGORY_LABELS: Record<string,string> = {
  vehicle:'Veículo', implement:'Implemento', equipment:'Equipamento', tracker:'Rastreador',
  phone_radio:'Celular/Rádio', tool:'Ferramenta', ppe:'EPI', other:'Outro',
};
export const ASSET_STATUS_LABELS: Record<string,string> = {
  available:'Disponível', in_use:'Em Uso', maintenance:'Manutenção', decommissioned:'Baixado', lost:'Extraviado',
};

export interface Asset {
  id: string; tenant_id: string; asset_code: string; category: string;
  name: string; description: string | null; status: string;
  serial_number: string | null; chassis_number: string | null; plate: string | null;
  brand: string | null; model: string | null; year: number | null;
  responsible_employee_id: string | null; current_location: string | null;
  branch: string | null; cost_center: string | null;
  supplier: string | null; acquisition_date: string | null;
  acquisition_cost: number; current_value: number;
  vehicle_id: string | null; notes: string | null;
  created_at: string; updated_at: string;
  employees?: { name: string } | null;
}

export interface AssetMovement {
  id: string; tenant_id: string; asset_id: string;
  movement_type: string; from_employee_id: string | null; to_employee_id: string | null;
  from_location: string | null; to_location: string | null;
  reason: string | null; notes: string | null; moved_at: string;
}

export function useAssets() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['assets', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await (supabase as any)
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
    mutationFn: async (values: Partial<Asset>) => {
      const { data, error } = await (supabase as any).from('assets').insert({
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
    mutationFn: async ({ id, ...values }: Partial<Asset> & { id: string }) => {
      const { data, error } = await (supabase as any).from('assets')
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
      const { data, error } = await (supabase as any)
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
    mutationFn: async (values: Partial<AssetMovement>) => {
      const { data, error } = await (supabase as any).from('asset_movements').insert({
        ...values, tenant_id: currentTenant!.id, created_by: user?.id,
      }).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['asset_movements'] }),
  });
}
