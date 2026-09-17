import { useMutation, useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';
import { parsePortalFinancialTitles } from '@/lib/portal/portalFinancialTitles';
import { downloadPortalFile } from '@/lib/portal/downloadPortalFile';

export function usePortalFinancialTitles(filters: {
  status?: string[];
  limit?: number;
  offset?: number;
} = {}) {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const { selectedClientId, clients } = usePortalClientScope();
  const actorId = user?.id;
  const tenantId = currentTenant?.id;
  const requiresClientSelection = clients.length > 1 && !selectedClientId;

  return useQuery({
    queryKey: ['portal_financial_titles', tenantId, actorId, selectedClientId, filters],
    queryFn: async ({ signal }) => {
      if (!tenantId || !actorId) throw new Error('Entre com uma sessão válida.');
      const { data, error } = await supabase.rpc('portal_list_financial_titles', {
        _tenant_id: tenantId,
        _client_id: selectedClientId ?? undefined,
        _status: filters.status,
        _limit: filters.limit ?? 50,
        _offset: filters.offset ?? 0,
      }).abortSignal(signal);
      if (error) throw error;
      return parsePortalFinancialTitles(data, {
        tenantId,
        actorId,
        clientId: selectedClientId,
      });
    },
    enabled: !!tenantId && !!actorId && !requiresClientSelection,
  });
}

export function useDownloadPortalFinancialTitle() {
  const { user } = useAuth();
  const { currentTenant } = useTenant();
  const actorId = user?.id;
  const tenantId = currentTenant?.id;

  return useMutation({
    mutationFn: async (titleId: string) => {
      if (!tenantId || !actorId) throw new Error('Entre com uma sessão válida.');
      return downloadPortalFile({
        tenant_id: tenantId,
        resource_type: 'financial_title',
        resource_id: titleId,
        format: 'pdf',
        fallbackFilename: `titulo-${titleId}.pdf`,
      });
    },
  });
}
