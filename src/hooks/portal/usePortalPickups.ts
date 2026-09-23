import { dateOnlyUtcRange } from '@/lib/utils/formatDate';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { assertPortalListPage, nextPortalListPage, PORTAL_LIST_PAGE_SIZE, type PortalListPageParam } from './portalListPaging';

export interface PortalPickup {
  id: string;
  client_id: string | null;
  can_cancel: boolean;
  pickup_number: string;
  remitter_name: string | null;
  remitter_cnpj: string | null;
  recipient_name: string | null;
  pickup_at: string;
  status: string;
  notes: string | null;
  linked_docs_count: number;
}

export function usePortalPickups(filters?: { status?: string; start?: string; end?: string }) {
  const { currentTenant } = useTenant();
  const { selectedClientId } = usePortalClientScope();
  const qc = useQueryClient();
  const queryKey = ['portal_pickups', currentTenant?.id, currentTenant?.timezone, selectedClientId, filters] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as PortalListPageParam | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!currentTenant) return assertPortalListPage<PortalPickup>({ rows: [], next_cursor: null, snapshot_at: new Date().toISOString(), revision: '' });
      const { data, error } = await supabase.rpc('list_client_pickups_page_v1' as never, {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _status: filters?.status || undefined,
        _start_date: filters?.start ? dateOnlyUtcRange(filters.start, currentTenant.timezone).from : undefined,
        _end_date: filters?.end ? new Date(Date.parse(dateOnlyUtcRange(filters.end, currentTenant.timezone).toExclusive) - 1).toISOString() : undefined,
        _page_size: PORTAL_LIST_PAGE_SIZE,
        _snapshot_at: pageParam?.snapshotAt,
        _cursor: pageParam?.cursor,
        _expected_revision: pageParam?.revision,
      } as never).abortSignal(signal);
      if (error) throw error;
      return assertPortalListPage<PortalPickup>(data);
    },
    getNextPageParam: nextPortalListPage,
    enabled: !!currentTenant,
  });
  return {
    ...query,
    data: query.data?.pages.flatMap((page) => page.rows) ?? [],
    restart: () => qc.resetQueries({ queryKey, exact: true }),
  };
}

export function useRequestPortalPickup() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { client_id: string; pickup_at: string; recipient_name?: string; notes?: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('request_client_pickup', {
        _tenant_id: currentTenant.id,
        _client_id: args.client_id,
        _pickup_at: args.pickup_at,
        _recipient_name: args.recipient_name || undefined,
        _notes: args.notes || undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.resetQueries({ queryKey: ['portal_pickups'] }),
  });
}

export function useCancelPortalPickup() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: { pickup_id: string; reason: string; request_id: string }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { error } = await supabase.rpc('cancel_client_pickup_v2', {
        _tenant_id: currentTenant.id,
        _pickup_id: args.pickup_id,
        _reason: args.reason,
        _request_id: args.request_id,
      });
      if (error) throw error;
    },
    onSuccess: () => qc.resetQueries({ queryKey: ['portal_pickups'] }),
  });
}
