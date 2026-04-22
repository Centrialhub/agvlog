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

export function useCreateLoadWithNextNumber() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Load>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await (supabase as any).rpc('create_load_with_next_number', {
        _tenant_id: currentTenant.id,
        _origin: values.origin ?? null,
        _destination: values.destination ?? null,
        _vehicle_id: values.vehicle_id ?? null,
        _driver_id: values.driver_id ?? null,
        _trip_id: values.trip_id ?? null,
        _notes: values.notes ?? null,
      });
      if (error) throw error;
      return data as Load;
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

async function unlinkLoadDependencies(loadIds: string[]) {
  // Unlink fiscal_documents
  const { error: fdErr } = await supabase
    .from('fiscal_documents')
    .update({ load_id: null } as any)
    .in('load_id', loadIds);
  if (fdErr) throw fdErr;

  // Unlink dispatch_trips
  const { error: dtErr } = await supabase
    .from('dispatch_trips')
    .update({ load_id: null } as any)
    .in('load_id', loadIds);
  if (dtErr) throw dtErr;

  // Delete load_items
  const { error: liErr } = await supabase
    .from('load_items')
    .delete()
    .in('load_id', loadIds);
  if (liErr) throw liErr;
}

export function useDeleteLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      await unlinkLoadDependencies([id]);
      const { error } = await supabase.from('loads').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}

export function useDeleteLoads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      await unlinkLoadDependencies(ids);
      const { error } = await supabase.from('loads').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}
