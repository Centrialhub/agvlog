import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

export const LOAD_STATUSES = [
  'planned', 'assembling', 'ready', 'loading', 'loaded',
  'in_transit', 'delivered', 'divergent',
] as const;

export type LoadStatus = typeof LOAD_STATUSES[number];

export const LOAD_STATUS_LABELS: Record<LoadStatus, string> = {
  planned: 'Planejada',
  assembling: 'Montando',
  ready: 'Pronta',
  loading: 'Carregando',
  loaded: 'Carregada',
  in_transit: 'Em Trânsito',
  delivered: 'Entregue',
  divergent: 'Divergente',
};

export interface Load {
  id: string;
  tenant_id: string;
  load_number: string;
  vehicle_id: string | null;
  driver_id: string | null;
  origin: string | null;
  destination: string | null;
  total_pallet_count: number;
  total_weight_kg: number;
  total_volume_m3: number;
  status: LoadStatus;
  trip_id: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
  vehicles?: { plate: string; nickname: string | null } | null;
  drivers?: { name: string } | null;
}

export function useLoads() {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['loads', currentTenant?.id],
    queryFn: async () => {
      if (!currentTenant) return [];
      const { data, error } = await supabase
        .from('loads')
        .select('*, vehicles(plate, nickname), drivers(name)')
        .eq('tenant_id', currentTenant.id)
        .order('created_at', { ascending: false });
      if (error) throw error;
      return (data || []) as Load[];
    },
    enabled: !!currentTenant,
  });
}

export function useCreateLoad() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Load>) => {
      const { data, error } = await supabase.from('loads').insert({
        ...values,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      } as any).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}

export function useUpdateLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Load> & { id: string }) => {
      const { data, error } = await supabase.from('loads').update({
        ...values,
        updated_at: new Date().toISOString(),
      } as any).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}
