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
      const { data, error } = await (supabase as any).rpc('list_client_pods_v2', {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId,
        _status: filters?.status || null,
        _start_date: filters?.start || null,
        _end_date: filters?.end || null,
        _limit: 200,
        _offset: 0,
      });
      if (error) throw error;
      return (data as any[]) as PortalPod[];
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
      const url = (data as any)?.signed_url;
      if (!url) throw new Error('Arquivo indisponível');
      return url;
    },
  });
}