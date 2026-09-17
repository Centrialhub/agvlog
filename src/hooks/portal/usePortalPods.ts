import { localDayBoundary, localDayEnd } from '@/lib/listFilters';
import { useInfiniteQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { assertPortalListPage, nextPortalListPage, PORTAL_LIST_PAGE_SIZE, type PortalListPageParam } from './portalListPaging';

export interface PortalPod {
  id: string;
  fiscal_document_id: string;
  load_id: string | null;
  invoice_number: string | null;
  proof_type: string;
  status: string;
  has_file: boolean;
  receiver_name: string | null;
  receiver_document: string | null;
  receiver_role: string | null;
  received_at: string | null;
  validated_at: string | null;
}

export function usePortalPods(filters?: { status?: string; start?: string; end?: string }) {
  const { currentTenant } = useTenant();
  const { selectedClientId } = usePortalClientScope();
  const qc = useQueryClient();
  const queryKey = ['portal_pods', currentTenant?.id, selectedClientId, filters] as const;
  const query = useInfiniteQuery({
    queryKey,
    initialPageParam: null as PortalListPageParam | null,
    queryFn: async ({ pageParam, signal }) => {
      if (!currentTenant) return assertPortalListPage<PortalPod>({ rows: [], next_cursor: null, snapshot_at: new Date().toISOString(), revision: '' });
      const { data, error } = await supabase.rpc('list_client_pods_page_v1' as never, {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _status: filters?.status || undefined,
        _start_date: filters?.start ? localDayBoundary(filters.start) : undefined,
        _end_date: filters?.end ? localDayEnd(filters.end) : undefined,
        _page_size: PORTAL_LIST_PAGE_SIZE,
        _snapshot_at: pageParam?.snapshotAt,
        _cursor: pageParam?.cursor,
        _expected_revision: pageParam?.revision,
      } as never).abortSignal(signal);
      if (error) throw error;
      return assertPortalListPage<PortalPod>(data);
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

export function useDownloadPortalPod() {
  const { currentTenant } = useTenant();
  return useMutation({
    mutationFn: async (podId: string): Promise<string> => {
      if (!currentTenant) throw new Error('Tenant não selecionado');
      const { data, error } = await supabase.functions.invoke('get-client-pod-signed-url', {
        body: { tenant_id: currentTenant.id, pod_id: podId },
      });
      if (error) throw error;
      const url = data && typeof data === 'object' && 'signed_url' in data
        ? data.signed_url
        : null;
      if (typeof url !== 'string' || !url) throw new Error('Arquivo indisponível');
      return url;
    },
  });
}
