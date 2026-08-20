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
        p_limit: 1000, // Safe limit for now
      });
      if (error) throw error;
      
      // The RPC returns { items, next_cursor, total_count }
      return data as PaginatedLoads;
    },
    enabled: !!currentTenant,
  });
}

/**
 * Array-compatibility wrapper for useLoads.
 * Returns the data as an array for components not yet migrated to pagination.
 */
export function useLoadsArray(filters: { search?: string; status?: LoadStatus[] } = {}) {
  const q = useLoads(filters);
  const dataArray = q.data?.items ?? [];
  return { ...q, data: dataArray } as any; // Cast to any to satisfy legacy array expectations
}

export function useCreateLoad() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (load: Partial<Load>) => {
      if (!currentTenant) throw new Error('Tenant not found');
      const { data, error } = await supabase
        .from('loads')
        .insert([{ ...load, tenant_id: currentTenant.id }])
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

/**
 * Atomic load creation with server-side numbering.
 */
export function useCreateLoadWithNextNumber() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (loadData: Partial<Load>) => {
      if (!currentTenant) throw new Error('Tenant not found');
      
      const nextNumber = await getNextLoadNumberFromExisting(currentTenant.id);
      
      const { data, error } = await supabase
        .from('loads')
        .insert([{ 
          ...loadData, 
          load_number: nextNumber,
          tenant_id: currentTenant.id 
        }])
        .select()
        .single();
        
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useUpdateLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...changes }: Partial<Load> & { id: string }) => {
      const { data, error } = await supabase
        .from('loads')
        .update(changes)
        .eq('id', id)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useDeleteLoad() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from('loads').delete().eq('id', id);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useDeleteLoads() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (ids: string[]) => {
      const { error } = await supabase.from('loads').delete().in('id', ids);
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
    },
  });
}

export function useHoldLoad() {
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, reason }: { id: string; reason: string }) => {
      const { error } = await (supabase as any).rpc('hold_load', {
        _load_id: id,
        _reason: reason,
        _user_id: user?.id
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

export async function getNextLoadNumberFromExisting(tenantId: string): Promise<string> {
  const { data, error } = await supabase.rpc('get_next_load_number_v1', {
    p_tenant_id: tenantId
  });
  if (error) throw error;
  return String(data || '1000');
}
