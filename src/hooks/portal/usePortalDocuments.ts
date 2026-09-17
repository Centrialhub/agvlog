import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

export interface PortalDocument {
  id: string;
  document_type: string;
  invoice_number: string | null;
  access_key: string | null;
  issue_date: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  value: number | null;
  weight_kg: number | null;
  status: string | null;
  load_id: string | null;
  client_id: string | null;
  has_pod: boolean;
}

export interface PortalDocumentsPage {
  rows: PortalDocument[];
  hasMore: boolean;
}

export function usePortalDocuments(filters?: {
  document_type?: string;
  search?: string;
  start?: string;
  end?: string;
  limit?: number;
  offset?: number;
}) {
  const { currentTenant } = useTenant();
  const { selectedClientId } = usePortalClientScope();
  return useQuery({
    queryKey: ['portal_documents', currentTenant?.id, selectedClientId, filters],
    queryFn: async (): Promise<PortalDocumentsPage> => {
      if (!currentTenant) return { rows: [], hasMore: false };
      const requestedLimit = filters?.limit ?? 50;
      const { data, error } = await supabase.rpc('list_client_documents_v2', {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _document_type: filters?.document_type || undefined,
        _search: filters?.search || undefined,
        _start_date: filters?.start || undefined,
        _end_date: filters?.end || undefined,
        _limit: requestedLimit + 1,
        _offset: filters?.offset ?? 0,
      });
      if (error) throw error;
      const rows = (data as PortalDocument[]) || [];
      return {
        rows: rows.slice(0, requestedLimit),
        hasMore: rows.length > requestedLimit,
      };
    },
    enabled: !!currentTenant,
  });
}
