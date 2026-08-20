import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';

import type { LoadStatus } from '@/lib/status/loadStatus';
export { LOAD_STATUSES, LOAD_STATUS_LABELS } from '@/lib/status/loadStatus';
export type { LoadStatus } from '@/lib/status/loadStatus';

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
  operation_type: string | null;
  supplier_manifest: string | null;
  distribution_manifest: string | null;
  shipment_manifest: string | null;
  origin_manifest: string | null;
  os_number: string | null;
  scheduled_load_at: string | null;
  actual_load_at: string | null;
  created_at: string;
  updated_at: string;
  on_hold?: boolean;
  hold_reason?: string | null;
  held_at?: string | null;
  held_by?: string | null;
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
      // guardrail:allow-direct-write
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

export async function getNextLoadNumberFromExisting(tenantId: string) {
  const { data, error } = await supabase
    .from('loads')
    .select('load_number')
    .eq('tenant_id', tenantId)
    .limit(10000);
  if (error) throw error;

  const maxNumber = (data || []).reduce((max, load: any) => {
    const match = String(load.load_number || '').match(/\d+/g);
    const number = match ? Number(match[match.length - 1]) : 0;
    return Number.isFinite(number) ? Math.max(max, number) : max;
  }, 1000);

  return String(maxNumber + 1);
}

export function useCreateLoadWithNextNumber() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Load>) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const loadNumber = values.load_number || await getNextLoadNumberFromExisting(currentTenant.id);
      // guardrail:allow-direct-write
      const { data, error } = await supabase.from('loads').insert({
        load_number: loadNumber,
        tenant_id: currentTenant.id,
        origin: values.origin ?? null,
        destination: values.destination ?? null,
        vehicle_id: values.vehicle_id ?? null,
        driver_id: values.driver_id ?? null,
        trip_id: values.trip_id ?? null,
        notes: values.notes ?? null,
        status: values.status ?? 'planned',
      } as any).select().single();
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
      // guardrail:allow-direct-write
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

export function useDeleteLoad() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc('delete_load_safely', {
        _tenant_id: currentTenant!.id,
        _load_id: id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}

export function useDeleteLoads() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { data, error } = await (supabase as any).rpc('delete_loads_safely', {
        _tenant_id: currentTenant!.id,
        _load_ids: ids,
      });
      if (error) throw error;
      const failed = Array.isArray(data) ? data.filter((r: any) => r && r.ok === false) : [];
      if (failed.length > 0) {
        throw new Error(
          `Não foi possível excluir ${failed.length} carga(s): ` +
            failed.map((f: any) => `${f.load_id}: ${f.error}`).join('; ')
        );
      }
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}

export function useHoldLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason?: string }) => {
      const { error } = await (supabase as any).rpc('hold_load', {
        _load_id: id,
        _reason: reason ?? null,
      });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
    },
  });
}

export function useUnholdLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await (supabase as any).rpc('unhold_load', { _load_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
    },
  });
}
