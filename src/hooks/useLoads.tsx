import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables, TablesInsert, TablesUpdate } from '@/integrations/supabase/types';

import type { LoadStatus } from '@/lib/status/loadStatus';
export { LOAD_STATUSES, LOAD_STATUS_LABELS } from '@/lib/status/loadStatus';
export type { LoadStatus } from '@/lib/status/loadStatus';

export type Load = Omit<Tables<'loads'>, 'status'> & {
  status: LoadStatus;
  vehicles?: { plate: string; nickname: string | null } | null;
  drivers?: { name: string } | null;
};

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

export interface LoadsPage {
  rows: Load[];
  totalCount: number;
  statusCounts: Record<string, number>;
}

export function useLoadsPage(input: {
  page: number;
  pageSize: number;
  filters: Record<string, Json>;
}) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['loads', 'page', currentTenant?.id, input.page, input.pageSize, input.filters],
    queryFn: async (): Promise<LoadsPage> => {
      if (!currentTenant) return { rows: [], totalCount: 0, statusCounts: {} };
      const { data, error } = await supabase.rpc('list_loads_page_v1', {
        _tenant_id: currentTenant.id,
        _filters: input.filters,
        _limit: input.pageSize,
        _offset: (input.page - 1) * input.pageSize,
      });
      if (error) throw error;
      const row = data?.[0];
      const rawItems = Array.isArray(row?.items) ? row.items : [];
      const rawCounts = row?.status_counts;
      const statusCounts = isJsonRecord(rawCounts)
        ? Object.fromEntries(
          Object.entries(rawCounts).map(([status, count]) => [status, Number(count) || 0]),
        )
        : {};
      return {
        rows: rawItems as unknown as Load[],
        totalCount: Number(row?.total_count) || 0,
        statusCounts,
      };
    },
    enabled: !!currentTenant,
    placeholderData: previous => previous,
  });
}

export function useCreateLoad() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (values: Partial<Load> & Pick<Load, 'load_number'>) => {
      const payload: TablesInsert<'loads'> = {
        ...values,
        load_number: values.load_number,
        tenant_id: currentTenant!.id,
        created_by: user?.id,
      };
      const { data, error } = await supabase.from('loads').insert(payload).select().single();
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

  const maxNumber = (data || []).reduce((max, load) => {
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
      const payload: TablesInsert<'loads'> = {
        load_number: loadNumber,
        tenant_id: currentTenant.id,
        origin: values.origin ?? null,
        destination: values.destination ?? null,
        vehicle_id: values.vehicle_id ?? null,
        driver_id: values.driver_id ?? null,
        trip_id: values.trip_id ?? null,
        notes: values.notes ?? null,
        status: values.status ?? 'planned',
      };
      const { data, error } = await supabase.from('loads').insert(payload).select().single();
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
      if ('status' in values) {
        throw new Error('Mudança de status deve passar por transition_load_status_v1.');
      }
      const payload: TablesUpdate<'loads'> = {
        ...values,
        updated_at: new Date().toISOString(),
      };
      const { data, error } = await supabase.from('loads').update(payload).eq('id', id).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['loads'] }),
  });
}

export function useTransitionLoadStatus() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, status, reason }: { id: string; status: LoadStatus; reason?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('transition_load_status_v1', {
        p_tenant_id: currentTenant.id,
        p_load_id: id,
        p_to_status: status,
        p_reason: reason ?? undefined,
      });
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
      const { error } = await supabase.rpc('delete_load_safely', {
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
      const { data, error } = await supabase.rpc('delete_loads_safely', {
        _tenant_id: currentTenant!.id,
        _load_ids: ids,
      });
      if (error) throw error;
      const failed = Array.isArray(data)
        ? data.filter((result): result is Record<string, Json> => isJsonRecord(result) && result.ok === false)
        : [];
      if (failed.length > 0) {
        throw new Error(
          `Não foi possível excluir ${failed.length} carga(s): ` +
            failed.map((failure) => `${String(failure.load_id ?? '')}: ${String(failure.error ?? '')}`).join('; ')
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
      const { error } = await supabase.rpc('hold_load', {
        _load_id: id,
        _reason: reason ?? undefined,
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
      const { error } = await supabase.rpc('unhold_load', { _load_id: id });
      if (error) throw error;
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['loads'] });
      qc.invalidateQueries({ queryKey: ['pending_loads_for_routing'] });
    },
  });
}

function isJsonRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
