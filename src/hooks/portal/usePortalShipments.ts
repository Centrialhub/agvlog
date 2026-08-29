import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';
import { usePortalClientScope } from '@/hooks/portal/usePortalClientScope';

export interface ShipmentRow {
  fiscal_document_id: string;
  invoice_number: string | null;
  access_key: string | null;
  document_type: string | null;
  document_status: string | null;
  client_load_number: string | null;
  reference_number: string | null;
  remitter: string | null;
  recipient: string | null;
  recipient_city: string | null;
  recipient_state: string | null;
  product_summary: string | null;
  pallet_count: number | null;
  weight_kg: number | null;
  value: number | null;
  freight_value: number | null;
  issue_date: string | null;
  load_number: string | null;
  load_status: string | null;
  stop_status: string | null;
  planned_arrival_at: string | null;
  actual_arrival_at: string | null;
  has_pod: boolean;
  has_open_occurrence: boolean;
  public_status: string | null;
  updated_at: string;
}

export interface ShipmentFilters {
  search?: string;
  status?: string[];
  startDate?: string;
  endDate?: string;
  city?: string;
  state?: string;
  hasPod?: boolean;
  hasOccurrence?: boolean;
  limit?: number;
  offset?: number;
}

export function usePortalShipments(filters: ShipmentFilters = {}) {
  const { currentTenant } = useTenant();
  const { selectedClientId } = usePortalClientScope();
  return useQuery({
    queryKey: ['portal_shipments', currentTenant?.id, selectedClientId, filters],
    queryFn: async (): Promise<{ rows: ShipmentRow[]; total: number }> => {
      if (!currentTenant) return { rows: [], total: 0 };
      const { data, error } = await supabase.rpc('search_client_portal_shipments_v2', {
        _tenant_id: currentTenant.id,
        _client_id: selectedClientId ?? undefined,
        _search: filters.search,
        _status: filters.status,
        _start_date: filters.startDate,
        _end_date: filters.endDate,
        _city: filters.city,
        _state: filters.state,
        _has_pod: filters.hasPod,
        _has_occurrence: filters.hasOccurrence,
        _limit: filters.limit ?? 50,
        _offset: filters.offset ?? 0,
      });
      if (error) throw error;
      return data as unknown as { rows: ShipmentRow[]; total: number };
    },
    enabled: !!currentTenant,
  });
}
