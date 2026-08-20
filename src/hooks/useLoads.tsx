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

export interface PaginatedLoads {
  items: Load[];
  next_cursor: string | null;
  total_count: number;
}

export function useLoads(filters: { search?: string; status?: LoadStatus[] } = {}) {
  const { currentTenant } = useTenant();
  return useQuery<PaginatedLoads>({
    queryKey: ['loads', currentTenant?.id, filters],
    queryFn: async () => {
      if (!currentTenant) return { items: [], next_cursor: null, total_count: 0 };
      const { data, error } = await supabase.rpc('list_loads_v1', {
        p_tenant_id: currentTenant.id,
        p_search: filters.search || null,
        p_status: filters.status || null,
        p_limit: 1000,
      });
      if (error) throw error;
      const result = data as any;
      return {
        items: (result.items || []) as Load[],
        next_cursor: result.next_cursor || null,
        total_count: Number(result.total_count) || 0,
      };
    },
    enabled: !!currentTenant,
  });
}

export function useLoadsArray(filters: { search?: string; status?: LoadStatus[] } = {}) {
  const q = useLoads(filters);
  return { ...q, data: q.data?.items ?? [] };
}

export function useCreateLoad() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Load>) => {
      const { data, error } = await (supabase as any).from('loads').insert({
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
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...values }: Partial<Load> & { id: string }) => {
      const { data, error } = await (supabase as any).from('loads').update({
        ...values,
        updated_by: user?.id,
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

export function getNextLoadNumberFromExisting(loads: Load[]): string {
  if (!loads || loads.length === 0) return '1000';
  const numbers = loads
    .map(l => parseInt(l.load_number))
    .filter(n => !isNaN(n));
  if (numbers.length === 0) return '1000';
  return (Math.max(...numbers) + 1).toString();
}
