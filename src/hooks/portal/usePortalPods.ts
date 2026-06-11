import { useQuery, useMutation } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

export interface PortalPod {
  id: string;
  fiscal_document_id: string;
  load_id: string | null;
  invoice_number: string | null;
  proof_type: string;
  status: string;
  storage_bucket: string | null;
  storage_path: string | null;
  receiver_name: string | null;
  receiver_document: string | null;
  receiver_role: string | null;
  received_at: string | null;
  validated_at: string | null;
}

export function usePortalPods(filters?: { status?: string; start?: string; end?: string }) {
  const { currentTenant } = useTenant();
  return useQuery({
    queryKey: ['portal_pods', currentTenant?.id, filters],
    queryFn: async (): Promise<PortalPod[]> => {
      if (!currentTenant) return [];
      const { data, error } = await supabase.rpc('list_client_pods', {
        _tenant_id: currentTenant.id,
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
      const { data: meta, error } = await supabase.rpc('get_client_pod_metadata', {
        _tenant_id: currentTenant.id,
        _pod_id: podId,
      });
      if (error) throw error;
      const row = (meta as any[])?.[0];
      if (!row?.storage_bucket || !row?.storage_path) {
        throw new Error('Arquivo indisponível');
      }
      const { data: signed, error: sErr } = await supabase.storage
        .from(row.storage_bucket)
        .createSignedUrl(row.storage_path, 300);
      if (sErr) throw sErr;
      return signed.signedUrl;
    },
  });
}