import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from './useTenant';
import { useAuth } from './useAuth';
import type { Json, Tables } from '@/integrations/supabase/types';
import { invalidateTripLoadQueries, isConfirmedLoadTransition, tripMutationError } from '@/lib/tripMutation';
import { useLoadAggregateCommand } from './useLoadAggregateCommand';
import type { LoadHeaderChanges } from '@/lib/loads/loadAggregateCommands';
import { readOperatorReferenceCatalog } from '@/lib/operator/operatorReferencePagination';

import type { LoadStatus } from '@/lib/status/loadStatus';
export { LOAD_STATUSES, LOAD_STATUS_LABELS } from '@/lib/status/loadStatus';
export type { LoadStatus } from '@/lib/status/loadStatus';

export type Load = Omit<Tables<'loads'>, 'status'> & {
  status: LoadStatus;
  vehicles?: { plate: string; nickname: string | null } | null;
  drivers?: { name: string } | null;
};

const LOAD_HEADER_KEYS = [
  'load_number', 'origin', 'destination', 'notes', 'operation_type',
  'scheduled_load_at', 'estimated_arrival_at', 'trailer_plate', 'ciot',
  'distribution_manifest', 'shipment_manifest', 'driver_id', 'vehicle_id',
  'merchandise_value', 'payment_method',
] as const;

function loadHeaderChanges(values: Partial<Load>): LoadHeaderChanges {
  return Object.fromEntries(LOAD_HEADER_KEYS.flatMap(key => (
    values[key] === undefined || (key === 'load_number' && !String(values[key]).trim())
      ? []
      : [[key, values[key]]]
  ))) as LoadHeaderChanges;
}

export function useLoads() {
  const { currentTenant } = useTenant();
  const { user } = useAuth();
  return useQuery({
    queryKey: ['loads', currentTenant?.id, user?.id],
    queryFn: async () => {
      if (!currentTenant || !user) return [];
      return await readOperatorReferenceCatalog({
        tenantId: currentTenant.id,
        actorId: user.id,
        resource: 'loads',
        includeInactive: true,
      }) as unknown as Load[];
    },
    enabled: !!currentTenant && !!user,
    retry: false,
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
  const { user } = useAuth();
  return useQuery({
    queryKey: ['loads', 'page', currentTenant?.id, user?.id, input.page, input.pageSize, input.filters],
    queryFn: async (): Promise<LoadsPage> => {
      if (!currentTenant || !user) return { rows: [], totalCount: 0, statusCounts: {} };
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
    enabled: !!currentTenant && !!user,
    placeholderData: previous => previous,
  });
}

export function useCreateLoad() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async (values: Partial<Load>) => {
      const result = await command.submit({ action: 'create', changes: loadHeaderChanges(values) });
      if (!('load' in result)) throw new Error('Criação da carga sem confirmação.');
      return result.load as unknown as Load;
    },
  });
}

export function useCreateLoadWithNextNumber() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async (values: Partial<Load>) => {
      const result = await command.submit({ action: 'create', changes: loadHeaderChanges(values) });
      if (!('load' in result)) throw new Error('Criação da carga sem confirmação.');
      return result.load as unknown as Load;
    },
  });
}

export function useUpdateLoad() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async ({ id, expectedVersion, reason, ...values }: Partial<Load> & { id: string; expectedVersion: number; reason?: string }) => {
      if ('status' in values) {
        throw new Error('Mudança de status deve passar por transition_load_status_v1.');
      }
      const result = await command.submit({
        action: 'update', load_id: id, expected_version: expectedVersion,
        changes: loadHeaderChanges(values), reason,
      });
      if (!('load' in result)) throw new Error('Atualização da carga sem confirmação.');
      return result.load as unknown as Load;
    },
  });
}

export function useTransitionLoadStatus() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    retry:false,
    mutationFn: async ({ id, status, reason }: { id: string; status: LoadStatus; reason?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('transition_load_status_v1', {
        p_tenant_id: currentTenant.id,
        p_load_id: id,
        p_to_status: status,
        p_reason: reason ?? undefined,
      });
      if (error) throw tripMutationError(error);
      if(!isConfirmedLoadTransition(data,id,status))throw new Error('Não foi possível confirmar o status da carga. Atualize os dados antes de continuar.');
      return data;
    },
    onSuccess: () => invalidateTripLoadQueries(qc),
    onError: () => invalidateTripLoadQueries(qc),
  });
}

export function useDeleteLoad() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async ({ id, expectedVersion, reason }: { id: string; expectedVersion: number; reason?: string }) => {
      const result = await command.submit({
        action: 'delete', load_id: id, expected_version: expectedVersion,
        reason: reason || 'Exclusão solicitada pelo operador.',
      });
      if (!('deleted_load_ids' in result) || !result.deleted_load_ids.includes(id)) {
        throw new Error('Exclusão da carga sem confirmação.');
      }
    },
  });
}

export function useDeleteLoads() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async (loads: Array<{ id: string; expectedVersion: number }>) => {
      const result = await command.submit({
        action: 'delete_many',
        targets: loads.map(load => ({ load_id: load.id, expected_version: load.expectedVersion })),
        reason: 'Exclusão em lote solicitada pelo operador.',
      });
      if (!('deleted_load_ids' in result) || result.deleted_load_ids.length !== loads.length) {
        throw new Error('Exclusão em lote sem confirmação integral.');
      }
    },
  });
}

export function useHoldLoad() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async ({ id, expectedVersion, reason }: { id: string; expectedVersion: number; reason: string }) => {
      const result = await command.submit({
        action: 'hold', load_id: id, expected_version: expectedVersion, reason,
      });
      if (!('load' in result)) throw new Error('Bloqueio da carga sem confirmação.');
      return result.load as unknown as Load;
    },
  });
}

export function useUnholdLoad() {
  const command = useLoadAggregateCommand();
  return useMutation({
    mutationFn: async ({ id, expectedVersion }: { id: string; expectedVersion: number }) => {
      const result = await command.submit({
        action: 'unhold', load_id: id, expected_version: expectedVersion,
      });
      if (!('load' in result)) throw new Error('Liberação da carga sem confirmação.');
      return result.load as unknown as Load;
    },
  });
}

function isJsonRecord(value: Json): value is Record<string, Json> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
