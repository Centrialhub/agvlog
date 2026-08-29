import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

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
  return useQuery({
    queryKey: ['portal_pods', currentTenant?.id, selectedClientId, filters],
    queryFn: async (): Promise<PortalPod[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_client_pods_v2', {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _status: filters?.status || undefined,
        _start_date: filters?.start || undefined,
        _end_date: filters?.end || undefined,
        _limit: 200,
        _offset: 0,
      });
      if (error) throw error;
      return data as PortalPod[];
    },
    enabled: !!currentTenant,
  });
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
