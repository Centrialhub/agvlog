import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { assertPortalListPage, nextPortalListPage, PORTAL_LIST_PAGE_SIZE, type PortalListPageParam } from './portalListPaging';

export interface PortalOccurrence {
  id: string;
  load_id: string | null;
  order_id: string | null;
  event_type: string;
  severity: string;
  description: string | null;
  public_status: string | null;
  client_action_required: boolean;
  client_opened: boolean;
  client_resolution_note: string | null;
  resolution: string | null;
  resolved_at: string | null;
  created_at: string;
}

export function usePortalOccurrences(filters?: { severity?: string; resolved?: boolean }) {
  const { currentTenant } = useTenant();
  const { selectedClientId } = usePortalClientScope();
  const qc = useQueryClient();
  const queryKey = ['portal_occurrences', currentTenant?.id, selectedClientId, filters] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as PortalListPageParam | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!currentTenant) return assertPortalListPage<PortalOccurrence>({ rows: [], next_cursor: null, snapshot_at: new Date().toISOString(), revision: '' });
      const { data, error } = await supabase.rpc('list_client_occurrences_page_v1' as never, {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _severity: filters?.severity || undefined,
        _resolved: filters?.resolved,
        _page_size: PORTAL_LIST_PAGE_SIZE,
        _snapshot_at: pageParam?.snapshotAt,
        _cursor: pageParam?.cursor,
        _expected_revision: pageParam?.revision,
      } as never).abortSignal(signal);
      if (error) throw error;
      return assertPortalListPage<PortalOccurrence>(data);
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

export function useCreatePortalOccurrence() {
  const { currentTenant } = useTenant();
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (args: {
      client_id: string;
      event_type: string;
      description: string;
      severity?: string;
      load_id?: string;
      order_id?: string;
    }) => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.rpc('create_client_occurrence', {
        _tenant_id: currentTenant.id,
        _client_id: args.client_id,
        _event_type: args.event_type,
        _description: args.description,
        _severity: args.severity || 'medium',
        _load_id: args.load_id || undefined,
        _order_id: args.order_id || undefined,
      });
      if (error) throw error;
      return data as string;
    },
    onSuccess: () => qc.resetQueries({ queryKey: ['portal_occurrences'] }),
  });
}
