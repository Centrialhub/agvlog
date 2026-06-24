import { useQuery } from '@tanstack/react-query';
import { supabase } from '@/integrations/supabase/client';
import { useTenant } from '@/hooks/useTenant';

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
  return useQuery({
    queryKey: ['portal_shipments', currentTenant?.id, filters],
    queryFn: async (): Promise<{ rows: ShipmentRow[]; total: number }> => {
      if (!currentTenant) return { rows: [], total: 0 };
      const { data, error } = await supabase.rpc('search_client_portal_shipments', {
        _tenant_id: currentTenant.id,
        _search: filters.search ?? null,
        _status: filters.status ?? null,
        _start_date: filters.startDate ?? null,
        _end_date: filters.endDate ?? null,
        _city: filters.city ?? null,
        _state: filters.state ?? null,
        _has_pod: filters.hasPod ?? null,
        _has_occurrence: filters.hasOccurrence ?? null,
        _limit: filters.limit ?? 50,
        _offset: filters.offset ?? 0,
      });
      if (error) throw error;
      return data as unknown as { rows: ShipmentRow[]; total: number };
    },
    enabled: !!currentTenant,
  });
}
